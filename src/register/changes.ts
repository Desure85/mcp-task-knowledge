/**
 * U-02 — `changes_since`: what changed across tasks, knowledge and temporal memory.
 *
 * Sources are deliberately the existing stores: task/doc `updatedAt` (U-02 pre-MU-03)
 * and temporal-graph `recordedAt`/`validTo`. The response is a flat, kind-tagged list
 * sorted newest-first; `nextSince` is the newest timestamp observed (or the request
 * `since` when nothing changed), so a poller can advance without overlap.
 */
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { DATA_DIR, resolveProject } from '../config.js';
import { join } from 'node:path';
import { TemporalGraph } from '../memory/temporal-graph.js';
import { storageProfile } from '../core/storage-context.js';
import { ok, errWith } from '../utils/respond.js';

export type ChangeKind = 'task' | 'knowledge' | 'memory';
export type ChangeType = 'created' | 'updated' | 'closed' | 'archived' | 'trashed' | 'recorded' | 'invalidated';

export interface ChangeItem {
  kind: ChangeKind;
  id: string;
  title: string;
  change: ChangeType;
  updatedAt: string;
}

function parseSince(since: string): number | null {
  const ms = Date.parse(since);
  return Number.isFinite(ms) ? ms : null;
}

function later(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function registerChangesTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'changes_since',
    {
      title: 'Changes Since',
      description:
        'Delta feed: tasks, knowledge docs and temporal memory facts changed at/after a timestamp. ' +
        'Returns {items:[{kind,id,title,change,updatedAt}], nextSince}; newest first.',
      inputSchema: {
        since: z.string().min(1).describe('ISO timestamp (inclusive)'),
        project: z.string().optional(),
        types: z.array(z.enum(['task', 'knowledge', 'memory'])).optional().describe('Defaults to all three'),
        includeDeleted: z.boolean().default(false).optional().describe('Include archived/trashed tasks/docs'),
        limit: z.number().int().min(1).max(500).default(100).optional(),
      },
    },
    async ({ since, project, types, includeDeleted, limit }) => {
      const sinceMs = parseSince(since);
      if (sinceMs === null) {
        return errWith({
          message: `invalid since timestamp: ${since}`,
          code: 'INVALID_SINCE',
          hint: 'Use an ISO 8601 timestamp, e.g. 2026-01-01T00:00:00.000Z',
        });
      }
      const prj = resolveProject(project);
      const wanted = new Set<ChangeKind>(types?.length ? types : ['task', 'knowledge', 'memory']);
      const items: ChangeItem[] = [];
      const include = (updatedAt: string | undefined): boolean => {
        if (!updatedAt) return false;
        const ms = Date.parse(updatedAt);
        return Number.isFinite(ms) && ms >= sinceMs;
      };

      if (wanted.has('task')) {
        const tasks = await storageProfile(ctx).tasks.list({
          project: prj,
          includeArchived: true,
          includeTrashed: true,
        });
        for (const task of tasks) {
          if (!include(task.updatedAt)) continue;
          if (!includeDeleted && (task.archived || task.trashed)) continue;
          const change: ChangeType = task.trashed
            ? 'trashed'
            : task.archived
              ? 'archived'
              : task.status === 'closed' || task.status === 'completed' || task.status === 'done'
                ? 'closed'
                : include(task.createdAt) && task.createdAt === task.updatedAt
                  ? 'created'
                  : 'updated';
          items.push({ kind: 'task', id: task.id, title: task.title, change, updatedAt: task.updatedAt });
        }
      }

      if (wanted.has('knowledge')) {
        const docs = await storageProfile(ctx).docs.list({
          project: prj,
          includeArchived: true,
          includeTrashed: true,
        });
        for (const doc of docs) {
          if (!include(doc.updatedAt)) continue;
          if (!includeDeleted && (doc.archived || doc.trashed)) continue;
          const change: ChangeType = doc.trashed
            ? 'trashed'
            : doc.archived
              ? 'archived'
              : include(doc.createdAt) && doc.createdAt === doc.updatedAt
                ? 'created'
                : 'updated';
          items.push({ kind: 'knowledge', id: doc.id, title: doc.title, change, updatedAt: doc.updatedAt });
        }
      }

      if (wanted.has('memory')) {
        try {
          const graph = new TemporalGraph({ storagePath: join(DATA_DIR, 'memory', 'temporal-graph.json') });
          const facts = graph.query({ includeInvalidated: true, limit: 1000 });
          for (const fact of facts) {
            const recorded = include(fact.recordedAt);
            const invalidated = fact.validTo ? include(fact.validTo) : false;
            if (!recorded && !invalidated) continue;
            items.push({
              kind: 'memory',
              id: fact.id,
              title: fact.statement,
              change: invalidated && !recorded ? 'invalidated' : 'recorded',
              updatedAt: invalidated && fact.validTo ? fact.validTo : fact.recordedAt,
            });
          }
        } catch {
          // Temporal graph absence/corruption must not hide task/doc changes.
        }
      }

      items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const capped = items.slice(0, limit ?? 100);
      const nextSince = items.length > 0 ? later(since, items[0].updatedAt) : since;
      return ok({ since, project: prj, count: capped.length, total: items.length, nextSince, items: capped });
    },
  );
}
