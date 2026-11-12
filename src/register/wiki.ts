/** T-05 tools: wiki backlinks/outgoing links and draft→published status. */
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { storageProfile } from '../core/storage-context.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
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

  const TEMPLATE_DIR = path.join(DATA_DIR, 'knowledge-templates');
  ctx.server.registerTool('knowledge_template_list', {
    title: 'Knowledge Template List',
    description: 'List markdown document templates from DATA_DIR/knowledge-templates.',
    inputSchema: {},
  }, async () => {
    const names = await fs.readdir(TEMPLATE_DIR).then((list) => list.filter((n) => n.endsWith('.md'))).catch(() => [] as string[]);
    const templates = [];
    for (const file of names) {
      const text = await fs.readFile(path.join(TEMPLATE_DIR, file), 'utf8').catch(() => '');
      templates.push({ id: file.replace(/\.md$/, ''), file, title: text.split('\n')[0]?.replace(/^#\s*/, '') ?? file });
    }
    return ok({ templates });
  });

  ctx.server.registerTool('knowledge_template_apply', {
    title: 'Knowledge Template Apply',
    description: 'Render a document template with {{title}}, {{project}}, {{date}}. Returns markdown; create the doc separately.',
    inputSchema: { templateId: z.string().min(1), title: z.string().min(1), project: z.string().optional() },
  }, async ({ templateId, title, project }: { templateId: string; title: string; project?: string }) => {
    const prj = resolveProject(project);
    if (!/^[\w.-]+$/.test(templateId)) return err('invalid templateId');
    let text: string;
    try { text = await fs.readFile(path.join(TEMPLATE_DIR, `${templateId}.md`), 'utf8'); } catch { return err(`template not found: ${templateId}`); }
    const rendered = text.replace(/\{\{title\}\}/g, title).replace(/\{\{project\}\}/g, prj).replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10));
    return ok({ templateId, project: prj, title, content: rendered });
  });

  ctx.server.registerTool('knowledge_review', {
    title: 'Knowledge Review',
    description: 'Record human review (reviewedBy/reviewedAt) and optionally publish a document.',
    inputSchema: { project: z.string().optional(), id: z.string().min(1), reviewer: z.string().min(1), publish: z.boolean().optional() },
  }, async ({ project, id, reviewer, publish }: { project?: string; id: string; reviewer: string; publish?: boolean }) => {
    const prj = resolveProject(project);
    const updated = await docStore(ctx).update(prj, id, {
      reviewedBy: reviewer,
      reviewedAt: new Date().toISOString(),
      ...(publish ? { status: 'published' as const } : {}),
    });
    if (!updated) return err(`Document not found: ${prj}/${id}`);
    return ok({ id, status: updated.status, reviewedBy: updated.reviewedBy, reviewedAt: updated.reviewedAt });
  });

  ctx.server.registerTool('knowledge_stale', {
    title: 'Knowledge Stale',
    description: 'List documents not updated for N days (default 90), newest-oldest first.',
    inputSchema: { project: z.string().optional(), days: z.number().int().min(1).max(3650).default(90).optional(), limit: z.number().int().min(1).max(200).default(50).optional() },
  }, async ({ project, days, limit }: { project?: string; days?: number; limit?: number }) => {
    const prj = resolveProject(project);
    const cutoff = Date.now() - (days ?? 90) * 86_400_000;
    const metas = await docStore(ctx).list({ project: prj, includeArchived: false, includeTrashed: false });
    const stale = metas
      .filter((m) => new Date(m.updatedAt).getTime() < cutoff)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit ?? 50)
      .map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt, status: m.status ?? 'published' }));
    return ok({ project: prj, days: days ?? 90, count: stale.length, documents: stale });
  });
}
