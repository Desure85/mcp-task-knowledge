/** T-05 tools: wiki backlinks/outgoing links and draft→published status. */
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { storageProfile } from '../core/storage-context.js';
import { ok, err } from '../utils/respond.js';
import { buildBacklinks, parseWikiLinks, resolveWikiTarget } from '../knowledge/wiki.js';

function docStore(ctx: ServerContext) { return storageProfile(ctx).docs; }

async function load(ctx: ServerContext, project: string) {
  const metas = await docStore(ctx).list({ project, includeArchived: true, includeTrashed: true });
  const docs = [];
  for (const meta of metas) {
    const doc = await docStore(ctx).read(project, meta.id);
    if (doc) docs.push({ id: doc.id, title: doc.title, content: doc.content ?? '' });
  }
  return docs;
}

export function registerWikiTools(ctx: ServerContext): void {
  ctx.server.registerTool('knowledge_backlinks', {
    title: 'Knowledge Backlinks',
    description: 'List documents that link to this document via [[wiki links]].',
    inputSchema: { project: z.string().optional(), id: z.string().min(1) },
  }, async ({ project, id }: { project?: string; id: string }) => {
    const prj = resolveProject(project);
    const docs = await load(ctx, prj);
    if (!docs.some((d) => d.id === id)) return err(`Document not found: ${prj}/${id}`);
    const backlinks = buildBacklinks(docs).get(id) ?? [];
    return ok({ project: prj, id, backlinks });
  });

  ctx.server.registerTool('knowledge_wikilinks', {
    title: 'Knowledge Wiki Links',
    description: 'List outgoing [[wiki links]] of a document and whether each resolves.',
    inputSchema: { project: z.string().optional(), id: z.string().min(1) },
  }, async ({ project, id }: { project?: string; id: string }) => {
    const prj = resolveProject(project);
    const doc = await docStore(ctx).read(prj, id);
    if (!doc) return err(`Document not found: ${prj}/${id}`);
    const docs = await load(ctx, prj);
    const links = parseWikiLinks(doc.content ?? '').map((target) => {
      const resolved = resolveWikiTarget(target, docs);
      return { target, resolvedId: resolved?.id ?? null, resolvedTitle: resolved?.title ?? null };
    });
    return ok({ project: prj, id, links });
  });

  ctx.server.registerTool('knowledge_publish', {
    title: 'Knowledge Publish',
    description: 'Set a document status to draft or published (wiki lifecycle).',
    inputSchema: { project: z.string().optional(), id: z.string().min(1), status: z.enum(['draft', 'published']) },
  }, async ({ project, id, status }: { project?: string; id: string; status: 'draft' | 'published' }) => {
    const prj = resolveProject(project);
    const updated = await docStore(ctx).update(prj, id, { status });
    if (!updated) return err(`Document not found: ${prj}/${id}`);
    return ok({ id, status: updated.status, version: updated.version });
  });
}
