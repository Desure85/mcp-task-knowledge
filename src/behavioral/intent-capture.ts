/**
 * behavioral/intent-capture.ts — Intent capture (BM-001).
 *
 * MCP tool `capture_intent` — records WHY code was written.
 * Captures: prompt, file, content hash.
 * Returns stable `memory_id`.
 * Idempotent — repeated capture of same intent returns `duplicate: true`.
 * Stored in knowledge_base with type=intent.
 *
 * Usage:
 *   const capture = new IntentCapture({ storagePath: '.behavioral' });
 *   const result = await capture.record({
 *     prompt: 'Add rate limiting to auth endpoint',
 *     file: 'src/auth.ts',
 *     contentHash: 'sha256:abc123...',
 *     context: { task: 'SEC-005', session: 's-123' },
 *   });
 *   // result.memory_id = 'intent-xxxxx'
 *   // result.duplicate = false
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('intent-capture');

// ─── Types ────────────────────────────────────────────────────────

export interface IntentRecord {
  /** Stable memory ID (deterministic from content). */
  memoryId: string;
  /** The prompt that triggered the code change. */
  prompt: string;
  /** File that was modified. */
  file: string;
  /** SHA-256 hash of the file content after modification. */
  contentHash: string;
  /** When the intent was captured (ISO 8601). */
  timestamp: string;
  /** Arbitrary context (task ID, session ID, etc.). */
  context: Record<string, unknown>;
  /** Tags for categorization. */
  tags: string[];
}

export interface CaptureResult {
  /** Stable memory ID. */
  memoryId: string;
  /** Whether this is a duplicate of an existing intent. */
  duplicate: boolean;
  /** The full intent record. */
  record: IntentRecord;
}

export interface IntentCaptureOptions {
  /** Directory for intent storage. Default: .behavioral. */
  storagePath?: string;
}

// ─── Storage Format ───────────────────────────────────────────────

interface IntentStorage {
  [memoryId: string]: IntentRecord;
}

// ─── IntentCapture ────────────────────────────────────────────────

export class IntentCapture {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: IntentStorage;

  constructor(options?: IntentCaptureOptions) {
    this.storagePath = options?.storagePath ?? '.behavioral';
    this.filePath = join(this.storagePath, 'intents.json');
    this.storage = this.load();
  }

  /**
   * Record an intent. Idempotent — same prompt+file+hash returns duplicate.
   */
  record(input: {
    prompt: string;
    file: string;
    contentHash: string;
    context?: Record<string, unknown>;
    tags?: string[];
  }): CaptureResult {
    const memoryId = this.computeMemoryId(input.prompt, input.file, input.contentHash);
    const duplicate = this.storage[memoryId] !== undefined;

    if (duplicate) {
      log.debug({ memoryId, file: input.file }, 'duplicate intent capture');
      return { memoryId, duplicate: true, record: this.storage[memoryId] };
    }

    const record: IntentRecord = {
      memoryId,
      prompt: input.prompt,
      file: input.file,
      contentHash: input.contentHash,
      timestamp: new Date().toISOString(),
      context: input.context ?? {},
      tags: input.tags ?? [],
    };

    this.storage[memoryId] = record;
    this.save();
    log.info({ memoryId, file: input.file }, 'intent captured');

    return { memoryId, duplicate: false, record };
  }

  /**
   * Get an intent by memory ID.
   */
  get(memoryId: string): IntentRecord | undefined {
    return this.storage[memoryId];
  }

  /**
   * List all intents, optionally filtered by file or tag.
   */
  list(filter?: { file?: string; tag?: string }): IntentRecord[] {
    let records = Object.values(this.storage);
    if (filter?.file) {
      records = records.filter((r) => r.file === filter.file);
    }
    if (filter?.tag) {
      records = records.filter((r) => r.tags.includes(filter.tag!));
    }
    return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Search intents by text in prompt.
   */
  search(query: string): IntentRecord[] {
    const lower = query.toLowerCase();
    return Object.values(this.storage)
      .filter((r) => r.prompt.toLowerCase().includes(lower))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get intents for a specific file.
   */
  getByFile(file: string): IntentRecord[] {
    return this.list({ file });
  }

  /**
   * Get intents by tag.
   */
  getByTag(tag: string): IntentRecord[] {
    return this.list({ tag });
  }

  /**
   * Delete an intent by memory ID.
   */
  delete(memoryId: string): boolean {
    if (!this.storage[memoryId]) return false;
    delete this.storage[memoryId];
    this.save();
    return true;
  }

  /**
   * Get count of stored intents.
   */
  get count(): number {
    return Object.keys(this.storage).length;
  }

  /**
   * Clear all intents.
   */
  clear(): void {
    this.storage = {};
    this.save();
  }

  /**
   * Compute file content hash (SHA-256).
   */
  static computeContentHash(content: string): string {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private computeMemoryId(prompt: string, file: string, contentHash: string): string {
    const raw = `${prompt}|${file}|${contentHash}`;
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `intent-${hash}`;
  }

  private load(): IntentStorage {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as IntentStorage;
      }
    } catch (err) {
      log.warn({ err }, 'failed to load intents, starting fresh');
    }
    return {};
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save intents');
    }
  }
}
