/** AA-04: draft journal and idempotent knowledge upsert tools. */
import { z } from 'zod/v3';
import path from 'node:path';
import type { ServerContext } from './context.js';
import { DATA_DIR, resolveProject } from '../config.js';
import { appendDraft, pendingDrafts } from '../drafts/journal.js';
import { syncDrafts } from '../drafts/sync.js';
import { upsertKnowledgeByExternalKey } from '../drafts/upsert.js';
import { ok } from '../utils/respond.js';

function journalRoot(): string {
  return process.env.DRAFT_JOURNAL_DIR || path.join(DATA_DIR, 'drafts');
}

export function registerDraftTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'draft_append',
    {
      title: 'Append Draft',
      description:
        'Append an idempotent draft record to the append-only journal. Repeating the same key returns the existing draft.',
      inputSchema: {
        key: z.string().min(1).describe('Stable key, e.g. draft:ses_<id>#<n>'),
        project: z.string().optional(),
        title: z.string().min(1),
        content: z.string(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ key, project, title, content, tags }) => {
      const prj = resolveProject(project);
      const result = await appendDraft(journalRoot(), { key, project: prj, title, content, tags });
      return ok({ draft: result.draft, created: result.created });
    },
  );

  ctx.server.registerTool(
    'draft_pending',
    {
      title: 'Pending Drafts',
      description: 'List journal drafts that have not been acknowledged by a successful sync.',
      inputSchema: {},
    },
    async () => ok({ drafts: await pendingDrafts(journalRoot()) }),
  );

  ctx.server.registerTool(
    'draft_sync',
    {
      title: 'Sync Drafts',
      description:
        'Upsert pending drafts into knowledge by externalKey, acking each one after success. Safe to retry.',
      inputSchema: {},
    },
    async () => {
      const result = await syncDrafts(journalRoot(), async (draft) => {
        await upsertKnowledgeByExternalKey({
          project: draft.project,
          externalKey: draft.key,
          title: draft.title,
          content: draft.content,
          tags: draft.tags,
        });
      });
      return ok(result);
    },
  );

  ctx.server.registerTool(
    'knowledge_upsert',
    {
      title: 'Upsert Knowledge',
      description: 'Create or update a knowledge document by stable externalKey (no duplicates on retry).',
      inputSchema: {
        externalKey: z.string().min(1),
        project: z.string().optional(),
        title: z.string().min(1),
        content: z.string(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ externalKey, project, title, content, tags }) => {
      const prj = resolveProject(project);
      const result = await upsertKnowledgeByExternalKey({ project: prj, externalKey, title, content, tags });
      return ok({ action: result.action, doc: result.doc });
    },
  );
}
