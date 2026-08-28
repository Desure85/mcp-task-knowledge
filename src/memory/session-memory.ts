/**
 * memory/session-memory.ts — Session memory (MEM-001).
 *
 * Persistent memory between AI agent sessions.
 * Auto-saves context, architectural decisions, conventions.
 *
 * Features:
 *   - Save and retrieve session context (what was done, what's next)
 *   - Architectural decisions (ADR-like records)
 *   - Conventions and patterns discovered during sessions
 *   - Cross-session continuity (new session can load previous context)
 *   - Time-based queries (what happened in last session)
 *
 * Storage: JSON file on disk (default: .session-memory.json)
 *
 * Usage:
 *   const mem = new SessionMemory({ filePath: '.session-memory.json' });
 *   await mem.saveSession({ summary: 'Implemented SEC-003', nextSteps: ['SEC-005'] });
 *   const last = await mem.getLastSession();
 *   const decisions = await mem.getDecisions();
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('session-memory');

// ─── Types ────────────────────────────────────────────────────────

export interface SessionRecord {
  /** Unique session ID. */
  id: string;
  /** Session start time (ISO 8601). */
  startedAt: string;
  /** Session end time (ISO 8601). */
  endedAt: string;
  /** Brief summary of what was accomplished. */
  summary: string;
  /** What needs to be done next. */
  nextSteps: string[];
  /** Files modified during this session. */
  filesModified: string[];
  /** Key decisions made during this session. */
  decisions: SessionDecision[];
  /** Conventions or patterns discovered. */
  conventions: string[];
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
}

export interface SessionDecision {
  /** Decision title. */
  title: string;
  /** What was decided. */
  decision: string;
  /** Why it was decided (rationale). */
  rationale: string;
  /** Alternatives considered. */
  alternatives?: string[];
  /** Tags for categorization. */
  tags?: string[];
  /** When the decision was made (ISO 8601). */
  timestamp: string;
}

export interface SessionMemoryOptions {
  /** File path for persistent storage. Default: .session-memory.json. */
  filePath?: string;
  /** Max sessions to keep (0 = unlimited). Default: 100. */
  maxSessions?: number;
}

// ─── Storage Format ───────────────────────────────────────────────

interface MemoryStorage {
  sessions: SessionRecord[];
  conventions: string[];
  version: number;
}

// ─── SessionMemory ────────────────────────────────────────────────

export class SessionMemory {
  private readonly filePath: string;
  private readonly maxSessions: number;
  private storage: MemoryStorage;

  constructor(options?: SessionMemoryOptions) {
    this.filePath = options?.filePath ?? '.session-memory.json';
    this.maxSessions = options?.maxSessions ?? 100;
    this.storage = this.load();
  }

  /**
   * Save a completed session.
   */
  saveSession(record: Omit<SessionRecord, 'id'>): SessionRecord {
    const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: SessionRecord = { id, ...record };

    this.storage.sessions.push(session);

    // Add new conventions
    for (const conv of session.conventions) {
      if (!this.storage.conventions.includes(conv)) {
        this.storage.conventions.push(conv);
      }
    }

    // Trim old sessions if over limit
    if (this.maxSessions > 0 && this.storage.sessions.length > this.maxSessions) {
      const excess = this.storage.sessions.length - this.maxSessions;
      this.storage.sessions = this.storage.sessions.slice(excess);
    }

    this.save();
    log.info({ id, summary: session.summary }, 'session saved');
    return session;
  }

  /**
   * Get the most recent session.
   */
  getLastSession(): SessionRecord | undefined {
    if (this.storage.sessions.length === 0) return undefined;
    return this.storage.sessions[this.storage.sessions.length - 1];
  }

  /**
   * Get a session by ID.
   */
  getSession(id: string): SessionRecord | undefined {
    return this.storage.sessions.find((s) => s.id === id);
  }

  /**
   * Get all sessions, optionally limited.
   */
  getSessions(limit?: number): SessionRecord[] {
    const sessions = [...this.storage.sessions].reverse(); // newest first
    return limit ? sessions.slice(0, limit) : sessions;
  }

  /**
   * Get all architectural decisions across all sessions.
   */
  getDecisions(): SessionDecision[] {
    const decisions: SessionDecision[] = [];
    for (const session of this.storage.sessions) {
      decisions.push(...session.decisions);
    }
    return decisions;
  }

  /**
   * Get decisions by tag.
   */
  getDecisionsByTag(tag: string): SessionDecision[] {
    return this.getDecisions().filter((d) => d.tags?.includes(tag));
  }

  /**
   * Get all conventions.
   */
  getConventions(): string[] {
    return [...this.storage.conventions];
  }

  /**
   * Add a convention.
   */
  addConvention(convention: string): void {
    if (!this.storage.conventions.includes(convention)) {
      this.storage.conventions.push(convention);
      this.save();
    }
  }

  /**
   * Search sessions by text (in summary, decisions, nextSteps).
   */
  search(query: string): SessionRecord[] {
    const lower = query.toLowerCase();
    return this.storage.sessions.filter((s) => {
      if (s.summary.toLowerCase().includes(lower)) return true;
      if (s.nextSteps.some((step) => step.toLowerCase().includes(lower))) return true;
      if (s.decisions.some((d) => d.title.toLowerCase().includes(lower) || d.decision.toLowerCase().includes(lower))) return true;
      return false;
    });
  }

  /**
   * Get sessions within a time range.
   */
  getSessionsInRange(startISO: string, endISO: string): SessionRecord[] {
    const start = new Date(startISO).getTime();
    const end = new Date(endISO).getTime();
    return this.storage.sessions.filter((s) => {
      const t = new Date(s.startedAt).getTime();
      return t >= start && t <= end;
    });
  }

  /**
   * Get a summary of what was done in the last N sessions.
   * Useful for starting a new session with context.
   */
  getContextSummary(lastN = 3): string {
    const recent = this.getSessions(lastN);
    if (recent.length === 0) return 'No previous sessions found.';

    const lines: string[] = ['## Recent Session Context', ''];

    for (const s of recent) {
      lines.push(`### ${s.startedAt} — ${s.summary}`);
      if (s.nextSteps.length > 0) {
        lines.push('**Next steps:**');
        for (const step of s.nextSteps) lines.push(`- ${step}`);
      }
      if (s.decisions.length > 0) {
        lines.push('**Decisions:**');
        for (const d of s.decisions) lines.push(`- ${d.title}: ${d.decision}`);
      }
      lines.push('');
    }

    if (this.storage.conventions.length > 0) {
      lines.push('## Conventions');
      for (const c of this.storage.conventions) lines.push(`- ${c}`);
    }

    return lines.join('\n');
  }

  /**
   * Delete a session by ID.
   */
  deleteSession(id: string): boolean {
    const idx = this.storage.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.storage.sessions.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * Clear all sessions and conventions.
   */
  clear(): void {
    this.storage = { sessions: [], conventions: [], version: 1 };
    this.save();
  }

  /**
   * Get stats.
   */
  getStats(): { sessionCount: number; decisionCount: number; conventionCount: number; oldestSession?: string; newestSession?: string } {
    const sessions = this.storage.sessions;
    return {
      sessionCount: sessions.length,
      decisionCount: this.getDecisions().length,
      conventionCount: this.storage.conventions.length,
      oldestSession: sessions[0]?.startedAt,
      newestSession: sessions[sessions.length - 1]?.startedAt,
    };
  }

  // ─── Internal ───────────────────────────────────────────────────

  private load(): MemoryStorage {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(content) as MemoryStorage;
        return {
          sessions: data.sessions ?? [],
          conventions: data.conventions ?? [],
          version: data.version ?? 1,
        };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load session memory, starting fresh');
    }
    return { sessions: [], conventions: [], version: 1 };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save session memory');
    }
  }
}
