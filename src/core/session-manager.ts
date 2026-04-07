/**
 * SessionManager — Multi-session lifecycle management (S-001)
 *
 * Tracks active MCP sessions with TTL and idle timeout support.
 * Designed for multi-client transports (TCP, Unix, HTTP) where
 * each connection gets its own MCP session.
 *
 * Features:
 *   - Session creation/destruction with unique IDs
 *   - TTL: max session lifetime (default: 24h)
 *   - Idle timeout: close if no activity (default: 30min)
 *   - Activity heartbeat: reset idle timer on activity
 *   - Graceful cleanup with custom onClose callbacks
 *   - Diagnostics: session count, active session info
 *   - Integrates with AppContainer lifecycle (cleanup on stop)
 *
 * Session lifecycle:
 *   created → active → (idle timeout OR TTL OR manual close) → closed
 *
 * Configuration:
 *   - maxSessions: number (default: 1000, env: MCP_MAX_SESSIONS)
 *   - sessionTtlMs: number (default: 86400000 = 24h, env: MCP_SESSION_TTL_MS)
 *   - idleTimeoutMs: number (default: 1800000 = 30min, env: MCP_IDLE_TIMEOUT_MS)
 *   - pruneIntervalMs: number (default: 60000 = 1min, env: MCP_PRUNE_INTERVAL_MS)
 *
 * Usage:
 *   const sm = new SessionManager({ maxSessions: 100 });
 *   const session = sm.create({ remote: '192.168.1.1:54321' });
 *   sm.heartbeat(session.id);  // reset idle timer
 *   sm.close(session.id);      // manual close
 *   await sm.closeAll();       // shutdown
 */

import { randomUUID } from 'node:crypto';
import { childLogger } from './logger.js';

const log = childLogger('session-manager');

// ─── Types ────────────────────────────────────────────────────────────

/** Session metadata stored by SessionManager. */
export interface SessionInfo {
  /** Unique session identifier (UUID v4). */
  id: string;
  /** Remote address (e.g. "192.168.1.1:54321" or "unix:/tmp/mcp.sock"). */
  remote: string;
  /** ISO timestamp when the session was created. */
  createdAt: string;
  /** ISO timestamp of last activity (heartbeat). */
  lastActivityAt: string;
  /** Milliseconds since session creation. */
  ageMs: number;
  /** Milliseconds since last activity. */
  idleMs: number;
  /** Optional metadata attached by the transport or auth layer. */
  metadata?: Record<string, unknown>;
}

/** Options for creating a new session. */
export interface CreateSessionOptions {
  /** Remote address string. */
  remote: string;
  /** Optional metadata to attach to the session. */
  metadata?: Record<string, unknown>;
  /** Optional callback invoked when the session is closed (by timeout or manually). */
  onClose?: (sessionId: string) => void | Promise<void>;
}

/** Configuration for SessionManager. */
export interface SessionManagerOptions {
  /** Maximum concurrent sessions. Default: 1000. */
  maxSessions?: number;
  /** Max session lifetime in milliseconds. Default: 86400000 (24h). */
  sessionTtlMs?: number;
  /** Idle timeout in milliseconds. Default: 1800000 (30min). */
  idleTimeoutMs?: number;
  /** Interval between prune sweeps in milliseconds. Default: 60000 (1min). */
  pruneIntervalMs?: number;
}

// ─── Internal session ────────────────────────────────────────────────

interface InternalSession {
  id: string;
  remote: string;
  createdAt: number;
  lastActivityAt: number;
  onClose?: (sessionId: string) => void | Promise<void>;
  metadata?: Record<string, unknown>;
}

// ─── SessionManager ──────────────────────────────────────────────────

export class SessionManager {
  private readonly sessions = new Map<string, InternalSession>();
  private pruneTimer?: ReturnType<typeof setInterval>;
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly idleMs: number;
  private readonly pruneMs: number;
  private _closed = false;

  constructor(options?: SessionManagerOptions) {
    this.maxSessions = options?.maxSessions
      ?? parseInt(process.env.MCP_MAX_SESSIONS || '1000', 10);
    this.ttlMs = options?.sessionTtlMs
      ?? parseInt(process.env.MCP_SESSION_TTL_MS || '86400000', 10);
    this.idleMs = options?.idleTimeoutMs
      ?? parseInt(process.env.MCP_IDLE_TIMEOUT_MS || '1800000', 10);
    this.pruneMs = options?.pruneIntervalMs
      ?? parseInt(process.env.MCP_PRUNE_INTERVAL_MS || '60000', 10);
  }

  // ─── Public getters ───────────────────────────────────────────────

  /** Current number of active sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Whether the manager has been shut down. */
  get closed(): boolean {
    return this._closed;
  }

  // ─── Session lifecycle ────────────────────────────────────────────

  /**
   * Create a new session with a unique ID.
   * @throws if max sessions limit is reached or manager is closed.
   */
  create(opts: CreateSessionOptions): SessionInfo {
    if (this._closed) {
      throw new Error('[session-manager] cannot create session — manager is closed');
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(
        `[session-manager] max sessions reached (${this.maxSessions}) — reject new connection`,
      );
    }

    const id = randomUUID();
    const now = Date.now();

    const session: InternalSession = {
      id,
      remote: opts.remote,
      createdAt: now,
      lastActivityAt: now,
      onClose: opts.onClose,
      metadata: opts.metadata,
    };

    this.sessions.set(id, session);
    log.info({ sessionId: id, remote: opts.remote, total: this.sessions.size }, 'session created');

    return this.toInfo(session);
  }

  /**
   * Record activity for a session (resets idle timer).
   * @returns true if session exists and was updated, false otherwise.
   */
  heartbeat(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.lastActivityAt = Date.now();
    return true;
  }

  /**
   * Close a specific session by ID.
   * Calls the onClose callback if provided.
   * @returns true if session existed and was closed, false otherwise.
   */
  async close(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);

    // Fire onClose callback (best-effort, don't let it throw)
    if (session.onClose) {
      try {
        await session.onClose(sessionId);
      } catch (err) {
        log.warn({ sessionId, err }, 'session onClose callback error');
      }
    }

    const duration = Date.now() - session.createdAt;
    log.info({ sessionId, remote: session.remote, durationMs: duration }, 'session closed');

    return true;
  }

  /**
   * Get info about a specific session.
   * @returns SessionInfo or undefined if not found.
   */
  get(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.toInfo(session) : undefined;
  }

  /**
   * Update session metadata (merge into existing metadata).
   * @param sessionId — session identifier
   * @param metadata — metadata to merge
   */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.metadata = { ...session.metadata, ...metadata };
    this.heartbeat(sessionId);
  }

  /**
   * Check if a session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get info about all active sessions.
   */
  getAll(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => this.toInfo(s));
  }

  // ─── Prune (TTL + idle) ──────────────────────────────────────────

  /**
   * Start the background prune timer that sweeps for expired/idle sessions.
   * Idempotent — safe to call multiple times.
   */
  startPrune(): void {
    if (this.pruneTimer) return;

    log.info({ intervalMs: this.pruneMs, ttlMs: this.ttlMs, idleMs: this.idleMs }, 'prune timer started');
    this.pruneTimer = setInterval(() => {
      this.prune().catch((err) => {
        log.error({ err }, 'prune sweep error');
      });
    }, this.pruneMs);

    // Don't prevent process exit
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Stop the background prune timer.
   */
  stopPrune(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
      log.info('prune timer stopped');
    }
  }

  /**
   * Manually trigger a prune sweep.
   * Removes sessions that exceeded TTL or idle timeout.
   * @returns array of closed session IDs.
   */
  async prune(): Promise<string[]> {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      const age = now - session.createdAt;
      const idle = now - session.lastActivityAt;

      if (age >= this.ttlMs) {
        log.info({ sessionId: id, ageMs: age, ttlMs: this.ttlMs }, 'session TTL expired');
        expired.push(id);
      } else if (idle >= this.idleMs) {
        log.info({ sessionId: id, idleMs: idle, idleTimeoutMs: this.idleMs }, 'session idle timeout');
        expired.push(id);
      }
    }

    // Close all expired sessions
    for (const id of expired) {
      await this.close(id);
    }

    if (expired.length > 0) {
      log.info({ closed: expired.length, remaining: this.sessions.size }, 'prune sweep completed');
    }

    return expired;
  }

  // ─── Shutdown ────────────────────────────────────────────────────

  /**
   * Close all sessions and stop the prune timer.
   * Typically called by AppContainer during shutdown.
   */
  async closeAll(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    this.stopPrune();

    const ids = Array.from(this.sessions.keys());
    if (ids.length > 0) {
      log.info({ count: ids.length }, 'closing all sessions');
      await Promise.allSettled(ids.map((id) => this.close(id)));
    }

    if (this.sessions.size > 0) {
      log.warn({ remaining: this.sessions.size }, 'some sessions could not be closed');
      this.sessions.clear();
    }
  }

  // ─── Internal ────────────────────────────────────────────────────

  private toInfo(session: InternalSession): SessionInfo {
    const now = Date.now();
    return {
      id: session.id,
      remote: session.remote,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivityAt: new Date(session.lastActivityAt).toISOString(),
      ageMs: now - session.createdAt,
      idleMs: now - session.lastActivityAt,
      metadata: session.metadata,
    };
  }
}
