/**
 * core/setup-link.ts — DX-29 one-time setup links for agent self-configuration.
 *
 * An admin creates a scoped setup link (`POST /admin/setup-links` or the
 * `admin_setup_link` MCP tool). The link points at
 * `GET /.well-known/mcp-setup/<otp>` which reveals — exactly once — a
 * markdown document containing everything an AI agent needs to configure
 * itself against this server: server URL, transport, a scoped access token,
 * capabilities and the default project.
 *
 * Security properties:
 *   - OTP is a crypto.randomUUID() — not sequential, not guessable.
 *   - Link TTL ~15 min; expired → 410 Gone.
 *   - One-time reveal: first successful GET marks the link used; second → 410.
 *   - Redemption rate-limit: >5 failed OTP lookups per OTP invalidates it.
 *   - Token is scoped (project + role + exp) and issued through the same
 *     token infrastructure the AuthManager validates against.
 *   - Audit-log entries on create + redeem (via SecurityStack auditLogger
 *     when SECURITY_STACK=1).
 */

import { randomUUID } from 'node:crypto';
import { childLogger } from './logger.js';
import type { AuditLogger } from '../audit/logger.js';

const log = childLogger('setup-link');

// ─── Types ──────────────────────────────────────────────────────────

export interface SetupLink {
  /** One-time password embedded in the URL (crypto.randomUUID). */
  otp: string;
  /** Scoped access token revealed to the agent. */
  token: string;
  /** Project scope for the issued token. */
  project: string;
  /** Role scope for the issued token. */
  role: string;
  /** Link expiry (ms since epoch). */
  expiresAt: number;
  /** Whether the link has already been revealed. */
  used: boolean;
  /** Failed redemption attempts (rate-limit). */
  failedAttempts: number;
  /** Creation time (ms since epoch). */
  createdAt: number;
  /** Session/user id of the creator. */
  createdBy: string;
}

export interface SetupLinkCreateOptions {
  project: string;
  role?: string;
  createdBy: string;
  /** Link TTL in ms (default: 15 min). */
  ttlMs?: number;
}

export type RedeemResult =
  | { status: 'ok'; link: SetupLink }
  | { status: 'gone'; reason: 'used' | 'expired' | 'invalidated' | 'not_found' };

/** Issues a scoped access token for the link. */
export type SetupTokenIssuer = (opts: {
  userId: string;
  roles: string[];
  ttlMs: number;
  metadata: Record<string, unknown>;
}) => Promise<string> | string;

export interface SetupLinkStoreOptions {
  /** Default link TTL (default: 15 min). */
  defaultTtlMs?: number;
  /** Max failed redemption attempts before the OTP is invalidated (default: 5). */
  maxFailedAttempts?: number;
  /** Cleanup interval for expired links (ms, 0 = disabled). Default: 60s. */
  cleanupIntervalMs?: number;
  /** Token issuer — must produce tokens the AuthManager validator accepts. */
  tokenIssuer: SetupTokenIssuer;
  /** Optional audit logger (SECURITY_STACK=1). */
  auditLogger?: AuditLogger;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

// ─── Store ──────────────────────────────────────────────────────────

export class SetupLinkStore {
  private readonly links = new Map<string, SetupLink>();
  private readonly opts: Required<Omit<SetupLinkStoreOptions, 'tokenIssuer' | 'auditLogger'>> & Pick<SetupLinkStoreOptions, 'auditLogger'>;
  private readonly tokenIssuer: SetupTokenIssuer;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: SetupLinkStoreOptions) {
    this.opts = {
      defaultTtlMs: options.defaultTtlMs ?? DEFAULT_TTL_MS,
      maxFailedAttempts: options.maxFailedAttempts ?? MAX_FAILED_ATTEMPTS,
      cleanupIntervalMs: options.cleanupIntervalMs ?? 60_000,
      auditLogger: options.auditLogger,
    };
    this.tokenIssuer = options.tokenIssuer;
    if (this.opts.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.opts.cleanupIntervalMs);
      this.cleanupTimer.unref?.();
    }
  }

  /** Create a new setup link. Returns the link (with token + otp). */
  async create(options: SetupLinkCreateOptions): Promise<SetupLink> {
    const now = Date.now();
    const ttl = options.ttlMs ?? this.opts.defaultTtlMs;
    const role = options.role ?? 'agent';
    const otp = randomUUID();
    const token = await this.tokenIssuer({
      userId: `setup-${otp.slice(0, 8)}`,
      roles: [role],
      ttlMs: ttl,
      metadata: { project: options.project, scope: 'setup' },
    });

    const link: SetupLink = {
      otp,
      token,
      project: options.project,
      role,
      expiresAt: now + ttl,
      used: false,
      failedAttempts: 0,
      createdAt: now,
      createdBy: options.createdBy,
    };
    this.links.set(otp, link);

    this.opts.auditLogger?.record('config.change', 'success', 'setup_link.create', {
      metadata: { otp, project: link.project, role: link.role, createdBy: link.createdBy, expiresAt: link.expiresAt },
    });
    log.info({ otp, project: link.project, role: link.role }, 'setup link created');
    return link;
  }

  /**
   * Redeem a link by OTP — one-time reveal.
   * Failed lookups count against the OTP's rate-limit budget; exceeding
   * maxFailedAttempts invalidates the link entirely.
   */
  redeem(otp: string, clientIp?: string): RedeemResult {
    const link = this.links.get(otp);
    if (!link) {
      return { status: 'gone', reason: 'not_found' };
    }
    if (link.used) {
      // Repeated hits on a consumed OTP count against the rate-limit budget.
      const invalidated = this.recordFailedAttempt(otp);
      this.opts.auditLogger?.record('config.change', 'denied', 'setup_link.redeem', {
        clientIp, metadata: { otp, reason: invalidated ? 'invalidated' : 'used' },
      });
      return { status: 'gone', reason: invalidated ? 'invalidated' : 'used' };
    }
    if (Date.now() >= link.expiresAt) {
      this.links.delete(otp);
      this.opts.auditLogger?.record('config.change', 'denied', 'setup_link.redeem', {
        clientIp, metadata: { otp, reason: 'expired' },
      });
      return { status: 'gone', reason: 'expired' };
    }

    link.used = true;
    this.opts.auditLogger?.record('config.change', 'success', 'setup_link.redeem', {
      clientIp, metadata: { otp, project: link.project, role: link.role },
    });
    log.info({ otp }, 'setup link redeemed');
    return { status: 'ok', link };
  }

  /**
   * Record a failed redemption attempt (e.g. malformed OTP that maps to a
   * known link id space). When attempts exceed the limit the link is
   * invalidated. Returns true if the link is now invalidated.
   */
  recordFailedAttempt(otp: string): boolean {
    const link = this.links.get(otp);
    if (!link) return false;
    link.failedAttempts += 1;
    if (link.failedAttempts > this.opts.maxFailedAttempts) {
      this.links.delete(otp);
      this.opts.auditLogger?.record('config.change', 'denied', 'setup_link.invalidated', {
        metadata: { otp, failedAttempts: link.failedAttempts },
      });
      log.warn({ otp, failedAttempts: link.failedAttempts }, 'setup link invalidated — too many failed attempts');
      return true;
    }
    return false;
  }

  /** Inspect a link without consuming it (admin diagnostics). */
  peek(otp: string): SetupLink | undefined {
    return this.links.get(otp);
  }

  /** Number of live (unexpired, unused) links. */
  get size(): number {
    return this.links.size;
  }

  /** Drop expired links. */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [otp, link] of this.links) {
      if (now >= link.expiresAt) {
        this.links.delete(otp);
        removed += 1;
      }
    }
    return removed;
  }

  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

// ─── Markdown document ──────────────────────────────────────────────

export interface SetupDocOptions {
  /** Public base URL of this server, e.g. http://host:3001. */
  serverUrl: string;
  /** Transport type: 'http' | 'stdio'. */
  transport: 'http' | 'stdio';
  /** Server name + version for the doc header. */
  serverName?: string;
  serverVersion?: string;
  /** Capabilities summary (tool count etc.). */
  toolCount?: number;
}

/**
 * Build the one-time reveal markdown document for an agent.
 * For http transport the doc carries the bearer token; for stdio it carries
 * an npx snippet + env vars instead.
 */
export function buildSetupMarkdown(link: SetupLink, opts: SetupDocOptions): string {
  const name = opts.serverName ?? 'mcp-task-knowledge';
  const version = opts.serverVersion ?? '0.0.0';
  const lines: string[] = [
    `# MCP Setup — ${name} v${version}`,
    '',
    `This document is shown **once**. Store the credentials below in your client config now.`,
    '',
    `## Server`,
    '',
    `- Name: ${name}`,
    `- Transport: ${opts.transport}`,
    `- Default project: \`${link.project}\``,
    `- Role: \`${link.role}\``,
    `- Link expires: ${new Date(link.expiresAt).toISOString()}`,
    '',
  ];

  if (opts.transport === 'http') {
    lines.push(
      `## Connection (Streamable HTTP)`,
      '',
      `- URL: \`${opts.serverUrl}\``,
      `- Token (Bearer, scoped to project \`${link.project}\`, role \`${link.role}\`):`,
      '',
      '```',
      link.token,
      '```',
      '',
      `## Client config snippet`,
      '',
      '```json',
      JSON.stringify({
        mcpServers: {
          [name]: {
            url: opts.serverUrl,
            headers: { Authorization: `Bearer ${link.token}` },
          },
        },
      }, null, 2),
      '```',
      '',
      `After connecting, call \`mcp.authenticate\` with the token above if your client does not send Authorization headers.`,
    );
  } else {
    lines.push(
      `## Connection (stdio)`,
      '',
      '```json',
      JSON.stringify({
        mcpServers: {
          [name]: {
            command: 'npx',
            args: ['-y', 'mcp-task-knowledge'],
            env: {
              DATA_DIR: './data',
              CURRENT_PROJECT: link.project,
              EMBEDDINGS_MODE: 'none',
            },
          },
        },
      }, null, 2),
      '```',
      '',
      `Stdio transport is a trusted local pipe — no token required.`,
    );
  }

  lines.push(
    '',
    `## Capabilities`,
    '',
    `- Tools registered: ${opts.toolCount ?? 'unknown'}`,
    `- Authenticate: \`mcp.authenticate\` (http/tcp)`,
    `- Tasks, knowledge base, prompts, memory, search — see \`tools/list\` after connecting.`,
    '',
    `## Self-config instructions`,
    '',
    `1. Merge the JSON snippet above into your client's MCP config.`,
    `2. Restart / reconnect the client.`,
    `3. Verify with \`tools/list\` — you should see the ${name} tool surface.`,
    `4. If authentication fails, the token may be expired — ask an admin for a new setup link.`,
    '',
  );

  return lines.join('\n');
}
