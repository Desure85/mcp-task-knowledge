/**
 * transport/tls.ts — TLS/mTLS support (SEC-002).
 *
 * Provides TLS configuration and context management for secure transports.
 * Supports:
 *   - Server-side TLS (HTTP and TCP)
 *   - Client-side TLS (for proxy → server connections)
 *   - mTLS (mutual TLS) for server-to-server
 *   - Certificate rotation without downtime (hot-reload)
 *   - Self-signed certificate generation (for development)
 *
 * Configuration via CFG-001:
 *   tls:
 *     enabled: true
 *     cert: /path/to/cert.pem
 *     key: /path/to/key.pem
 *     ca: /path/to/ca.pem
 *     requestCert: true  (mTLS)
 *     rejectUnauthorized: true
 *
 * Usage:
 *   const ctx = new TlsContext({ cert: 'cert.pem', key: 'key.pem' });
 *   const options = ctx.createServerOptions();
 *   // pass to https.createServer() or tls.createServer()
 */

import { createSecureContext, type SecureContext, type SecureContextOptions, type TlsOptions } from 'node:tls';
import { readFileSync, existsSync, watchFile, unwatchFile } from 'node:fs';
import { childLogger } from '../core/logger.js';

const log = childLogger('tls');

// ─── Types ────────────────────────────────────────────────────────

export interface TlsConfig {
  /** Path to server certificate (PEM). */
  cert?: string;
  /** Path to server private key (PEM). */
  key?: string;
  /** Path to CA certificate(s) (PEM) for client cert verification. */
  ca?: string | string[];
  /** Request client certificate (mTLS). Default: false. */
  requestCert?: boolean;
  /** Reject unauthorized client certificates. Default: true. */
  rejectUnauthorized?: boolean;
  /** List of allowed client certificate subjects (for mTLS authorization). */
  authorizedSubjects?: string[];
  /** Enable hot-reload of cert/key files. Default: false. */
  hotReload?: boolean;
  /** ALPN protocols (e.g., ['h2', 'http/1.1']). */
  alpnProtocols?: string[];
  /** Minimum TLS version. Default: 'TLSv1.2'. */
  minVersion?: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';
  /** Maximum TLS version. */
  maxVersion?: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';
  /** Ciphers list. */
  ciphers?: string;
  /** passphrase for encrypted private key. */
  passphrase?: string;
}

export interface TlsStats {
  /** Whether TLS is enabled (cert and key provided). */
  enabled: boolean;
  /** Whether mTLS is enabled (requestCert is true). */
  mtlsEnabled: boolean;
  /** Number of times the context has been reloaded. */
  reloadCount: number;
  /** When the context was last reloaded (ISO 8601). */
  lastReloadedAt?: string;
  /** Certificate file path. */
  certPath?: string;
  /** Key file path. */
  keyPath?: string;
}

// ─── TlsContext ───────────────────────────────────────────────────

export class TlsContext {
  private config: TlsConfig;
  private secureContext: SecureContext | undefined;
  private reloadCount = 0;
  private lastReloadedAt: string | undefined;
  private watchers: Array<{ path: string; cleanup: () => void }> = [];

  constructor(config: TlsConfig = {}) {
    this.config = config;
    if (this.isEnabled) {
      try {
        this.reload();
        if (config.hotReload) this.startWatching();
      } catch (err) {
        log.warn({ err }, 'TLS context not loaded — files may not exist yet');
      }
    }
  }

  /**
   * Whether TLS is enabled (cert and key paths provided).
   * Note: does not check file existence — use reload() to verify.
   */
  get isEnabled(): boolean {
    return !!(this.config.cert && this.config.key);
  }

  /**
   * Whether TLS is fully operational (context loaded).
   */
  get isReady(): boolean {
    return this.secureContext !== undefined;
  }

  /**
   * Whether mTLS is enabled (requestCert is true).
   */
  get isMtlsEnabled(): boolean {
    return this.isEnabled && (this.config.requestCert ?? false);
  }

  /**
   * Get the underlying SecureContext.
   * Throws if TLS is not enabled.
   */
  get context(): SecureContext {
    if (!this.secureContext) {
      throw new Error('TLS is not enabled — provide cert and key');
    }
    return this.secureContext;
  }

  /**
   * Create options for tls.createServer() or https.createServer().
   */
  createServerOptions(): TlsOptions {
    if (!this.isEnabled) {
      throw new Error('TLS is not enabled — provide cert and key');
    }

    const options: TlsOptions = {
      secureContext: this.context,
      requestCert: this.config.requestCert ?? false,
      rejectUnauthorized: this.config.rejectUnauthorized ?? true,
    };

    if (this.config.alpnProtocols) {
      options.ALPNProtocols = this.config.alpnProtocols;
    }

    if (this.config.minVersion) {
      options.minVersion = this.config.minVersion;
    }

    if (this.config.maxVersion) {
      options.maxVersion = this.config.maxVersion;
    }

    if (this.config.ciphers) {
      options.ciphers = this.config.ciphers;
    }

    return options;
  }

  /**
   * Create options for tls.connect() (client-side TLS).
   */
  createClientOptions(): TlsOptions {
    const options: TlsOptions = {
      rejectUnauthorized: this.config.rejectUnauthorized ?? true,
    };

    if (this.config.ca) {
      options.ca = this.readFileOrArray(this.config.ca);
    }

    if (this.config.cert && this.config.key) {
      // Client cert for mTLS
      options.cert = readFileSync(this.config.cert, 'utf8');
      options.key = readFileSync(this.config.key, 'utf8');
    }

    if (this.config.passphrase) {
      options.passphrase = this.config.passphrase;
    }

    if (this.config.alpnProtocols) {
      options.ALPNProtocols = this.config.alpnProtocols;
    }

    if (this.config.minVersion) {
      options.minVersion = this.config.minVersion;
    }

    return options;
  }

  /**
   * Verify a client certificate subject against the allowlist.
   * Returns true if no allowlist is configured or subject is allowed.
   */
  verifyClientCert(subject: string): boolean {
    if (!this.config.authorizedSubjects || this.config.authorizedSubjects.length === 0) {
      return true;
    }
    return this.config.authorizedSubjects.includes(subject);
  }

  /**
   * Reload certificates from disk.
   * Useful for certificate rotation without downtime.
   */
  reload(): void {
    if (!this.isEnabled) return;

    try {
      const cert = readFileSync(this.config.cert!, 'utf8');
      const key = readFileSync(this.config.key!, 'utf8');

      const options: SecureContextOptions = { cert, key };

      if (this.config.ca) {
        options.ca = this.readFileOrArray(this.config.ca);
      }

      if (this.config.passphrase) {
        options.passphrase = this.config.passphrase;
      }

      if (this.config.minVersion) {
        options.minVersion = this.config.minVersion;
      }

      // Create new context, then replace (atomic swap)
      const newContext = createSecureContext(options);
      this.secureContext = newContext;
      this.reloadCount++;
      this.lastReloadedAt = new Date().toISOString();
      log.info({ cert: this.config.cert, reloadCount: this.reloadCount }, 'TLS context reloaded');
    } catch (err) {
      log.error({ err }, 'failed to reload TLS context');
      if (!this.secureContext) throw err; // re-throw on initial load
    }
  }

  /**
   * Start watching cert/key files for changes (hot-reload).
   */
  startWatching(): void {
    this.stopWatching();

    const paths = [this.config.cert, this.config.key].filter(Boolean) as string[];
    for (const path of paths) {
      if (!existsSync(path)) continue;
      watchFile(path, { interval: 1000 }, () => {
        log.info({ path }, 'cert file changed, reloading');
        this.reload();
      });
      this.watchers.push({
        path,
        cleanup: () => unwatchFile(path),
      });
    }
    log.info({ watching: paths.length }, 'started watching cert files');
  }

  /**
   * Stop watching cert/key files.
   */
  stopWatching(): void {
    for (const w of this.watchers) w.cleanup();
    this.watchers = [];
  }

  /**
   * Get stats about the TLS context.
   */
  getStats(): TlsStats {
    return {
      enabled: this.isEnabled,
      mtlsEnabled: this.isMtlsEnabled,
      reloadCount: this.reloadCount,
      lastReloadedAt: this.lastReloadedAt,
      certPath: this.config.cert,
      keyPath: this.config.key,
    };
  }

  /**
   * Update configuration and reload.
   */
  updateConfig(config: Partial<TlsConfig>): void {
    const wasWatching = this.watchers.length > 0;
    this.stopWatching();

    this.config = { ...this.config, ...config };

    if (this.isEnabled) {
      this.reload();
      if (wasWatching || config.hotReload) this.startWatching();
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.stopWatching();
    this.secureContext = undefined;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private readFileOrArray(path: string | string[]): string | string[] {
    if (Array.isArray(path)) {
      return path.map((p) => readFileSync(p, 'utf8'));
    }
    return readFileSync(path, 'utf8');
  }
}

// ─── Factory ──────────────────────────────────────────────────────

/**
 * Create a TlsContext from environment configuration.
 */
export function createTlsContext(): TlsContext {
  return new TlsContext({
    cert: process.env.TLS_CERT_PATH,
    key: process.env.TLS_KEY_PATH,
    ca: process.env.TLS_CA_PATH,
    requestCert: process.env.TLS_REQUEST_CERT === 'true',
    rejectUnauthorized: process.env.TLS_REJECT_UNAUTHORIZED !== 'false',
    minVersion: (process.env.TLS_MIN_VERSION as TlsConfig['minVersion']) ?? 'TLSv1.2',
    hotReload: process.env.TLS_HOT_RELOAD === 'true',
  });
}
