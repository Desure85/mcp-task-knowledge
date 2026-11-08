/**
 * AC-03c — response projections for write tools.
 *
 * Write tools returned the whole written record (task/документ) on every call: ~0.3 KB per
 * `tasks_create`, ×55 calls in the measured experiment ≈ 16 KB of duplicated payload. Two
 * optional arguments let a caller ask for less:
 *
 *   `fields: ['id']`  — exactly the requested fields (same projection as list/search);
 *   `compact: true`   — a fixed minimal record an agent needs to continue the work.
 *
 * Without either flag the response is byte-identical to before.
 */

import { z } from 'zod/v3';
import { pickFields } from '../utils/pagination.js';

/** What a caller may add to a write tool to shrink its response. */
export const writeResponseArgs = {
  fields: z.array(z.string()).optional().describe('Return only these fields of the written record'),
  compact: z
    .boolean()
    .optional()
    .describe('Return the minimal record (id, title, status or type, updatedAt)'),
};

export interface WriteResponseOptions {
  fields?: string[];
  compact?: boolean;
}

/** Minimal task an agent needs to keep working: identity, title, status, priority, freshness. */
export const COMPACT_TASK_FIELDS = ['id', 'title', 'status', 'priority', 'updatedAt'] as const;

/** Minimal document: identity, title, type, freshness (content is never included anyway). */
export const COMPACT_DOC_FIELDS = ['id', 'title', 'type', 'updatedAt'] as const;

function project(item: unknown, options: WriteResponseOptions, compactFields: readonly string[]): unknown {
  if (options.fields && options.fields.length > 0) return pickFields(item, options.fields);
  if (options.compact === true) return pickFields(item, [...compactFields]);
  return item;
}

export function projectTask<T>(task: T, options: WriteResponseOptions = {}): unknown {
  return project(task, options, COMPACT_TASK_FIELDS);
}

export function projectDoc<T>(doc: T, options: WriteResponseOptions = {}): unknown {
  return project(doc, options, COMPACT_DOC_FIELDS);
}
