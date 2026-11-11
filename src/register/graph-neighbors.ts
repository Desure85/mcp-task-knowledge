/**
 * U-06 — `graph_neighbors`: who is related to X and why.
 *
 * One call for agents: task dependencies, task/knowledge hierarchy, and memory
 * facts that mention the node. No new server-side graph format; it reads the
 * existing stores and temporal graph and returns a flat, reason-tagged list.
 */
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { DATA_DIR, resolveProject } from '../config.js';
import { join } from 'node:path';
import { TemporalGraph } from '../memory/temporal-graph.js';
import { storageProfile } from '../core/storage-context.js';
import { ok } from '../utils/respond.js';

export type NeighborKind = 'task' | 'knowledge' | 'memory';
export type NeighborRelation = 'depends_on' | 'blocks' | 'parent' | 'child' | 'mentions';

export interface Neighbor {
  kind: NeighborKind;
  id: string;
  title: string;
  relation: NeighborRelation;
  direction: 'in' | 'out';
}

const FIELD_KEYS = ['kind', 'id', 'title', 'relation', 'direction'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function projectItems(items: Neighbor[], fields?: FieldKey[]): Array<Partial<Neighbor>> {
  if (!fields || fields.length === 0) return items;
  return items.map((item) => Object.fromEntries(fields.map((key) => [key, item[key]])));
}

export function registerGraphNeighborsTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'graph_neighbors',
    {
      title: 'Graph Neighbors',
      description:
        'Return neighbors of a task/document/entity with the reason for each edge: task dependency, parent/child, ' +
        'or memory-fact mention. Existing stores only; no new graph format.',
      inputSchema: {
        id: z.string().min(1).describe('Task id, document id, or entity label'),
        project: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        fields: z
          .array(z.enum(FIELD_KEYS))
          .optional()
          .describe('Project the item fields (kind,id,title,relation,direction)'),
      },
    },
    async ({ id, project, limit, fields }) => {
      const prj = resolveProject(project);
      const cap = limit ?? 50;
      const items: Neighbor[] = [];
      const seen = new Set<string>();
      const push = (item: Neighbor) => {
        const key = `${item.kind}:${item.id}:${item.relation}:${item.direction}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push(item);
      };

      const tasks = await storageProfile(ctx).tasks.list({ project: prj });
      const docs = await storageProfile(ctx).docs.list({ project: prj });

      const task = tasks.find((t) => t.id === id);
      const doc = docs.find((d) => d.id === id);
      const label = task?.title ?? doc?.title ?? id;

      if (task) {
        const byId = new Map(tasks.map((t) => [t.id, t]));
        for (const depId of task.dependsOn ?? []) {
          const dep = byId.get(depId);
          if (dep) push({ kind: 'task', id: dep.id, title: dep.title, relation: 'depends_on', direction: 'out' });
        }
        for (const other of tasks) {
          if ((other.dependsOn ?? []).includes(task.id)) {
            push({ kind: 'task', id: other.id, title: other.title, relation: 'blocks', direction: 'in' });
          }
        }
        if (task.parentId) {
          const parent = byId.get(task.parentId);
          if (parent) push({ kind: 'task', id: parent.id, title: parent.title, relation: 'parent', direction: 'out' });
        }
        for (const child of tasks.filter((t) => t.parentId === task.id)) {
          push({ kind: 'task', id: child.id, title: child.title, relation: 'child', direction: 'in' });
        }
      }

      if (doc) {
        if (doc.parentId) {
          const parent = docs.find((d) => d.id === doc.parentId);
          if (parent) push({ kind: 'knowledge', id: parent.id, title: parent.title, relation: 'parent', direction: 'out' });
        }
        for (const child of docs.filter((d) => d.parentId === doc.id)) {
          push({ kind: 'knowledge', id: child.id, title: child.title, relation: 'child', direction: 'in' });
        }
      }

      // Memory facts that mention the node/entity; a task/document title is a strong label,
      // a raw entity label is matched against entities and statement text.
      try {
        const graph = new TemporalGraph({ storagePath: join(DATA_DIR, 'memory', 'temporal-graph.json') });
        const facts = graph.query({ includeInvalidated: false, limit: 1000 });
        const needle = label.toLowerCase();
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordRe = needle.length >= 3 ? new RegExp(`\\b${escaped}\\b`) : null;
        for (const fact of facts) {
          const entities = (fact.entities ?? []).map((e) => e.toLowerCase());
          const matches = entities.includes(needle) || (wordRe !== null && wordRe.test(fact.statement.toLowerCase()));
          if (matches) {
            push({ kind: 'memory', id: fact.id, title: fact.statement, relation: 'mentions', direction: 'in' });
          }
        }
      } catch {
        // Missing/corrupt temporal graph is not a reason to hide task/doc neighbors.
      }

      return ok({
        project: prj,
        query: id,
        count: Math.min(items.length, cap),
        total: items.length,
        neighbors: projectItems(items.slice(0, cap), fields),
      });
    },
  );
}
