import type { ServerContext } from './context.js';
import type { KnowledgeDoc } from '../types.js';
import type { VectorSearchAdapter } from '../search/index.js';
import { listTasks } from '../storage/tasks.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { buildTextForTask, buildTextForDoc, hybridSearch, twoStageHybridKnowledgeSearch } from '../search/index.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('resources');

export function registerSearchResources(ctx: ServerContext): void {
  const handleSearchTasksHref = async (href: string) => {
    const recentM = href.match(/^search:\/\/tasks\/([^\/]+)\/recent$/);
    if (recentM) {
      const project = decodeURIComponent(recentM[1]);
      if (!project) {
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'project is required' }, null, 2), mimeType: 'application/json' }] };
      }
      const items: any[] = await listTasks({ project, includeArchived: false } as any);
      items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return { contents: [{ uri: href, text: JSON.stringify(items.slice(0, 20), null, 2), mimeType: 'application/json' }] };
    }
    const paramsM = href.match(/^search:\/\/tasks\/([^\/]+)\/([^\/]+)$/);
    if (paramsM) {
      const project = decodeURIComponent(paramsM[1]);
      const rawParams = paramsM[2];
      if (!project || !rawParams) {
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'project and params are required' }, null, 2), mimeType: 'application/json' }] };
      }
      let params: any = {};
      try { params = JSON.parse(Buffer.from(ctx.normalizeBase64(rawParams), 'base64').toString('utf8')); }
      catch { try { params = JSON.parse(decodeURIComponent(rawParams)); } catch {} }
      const query: string = String(params.query || '').trim();
      if (!query) {
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'query is required' }, null, 2), mimeType: 'application/json' }] };
      }
      const limit: number = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
      const tasks = await listTasks({ project, includeArchived: false } as any);
      const items = tasks.map((t) => ({ id: t.id, text: buildTextForTask(t), item: t }));
      const results = await hybridSearch(query, items, { limit, vectorAdapter: await ctx.ensureVectorAdapter() });
      return { contents: [{ uri: href, text: JSON.stringify(results, null, 2), mimeType: 'application/json' }] };
    }
    return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'unsupported search://tasks path' }, null, 2), mimeType: 'application/json' }] };
  };

  const handleSearchKnowledgeHref = async (href: string) => {
    const recentM = href.match(/^search:\/\/knowledge\/([^\/]+)\/recent$/);
    if (recentM) {
      const project = decodeURIComponent(recentM[1]);
      if (!project) {
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'project is required' }, null, 2), mimeType: 'application/json' }] };
      }
      const items: any[] = await listDocs({ project, includeArchived: false } as any);
      const sorted = items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return { contents: [{ uri: href, text: JSON.stringify(sorted.slice(0, 20), null, 2), mimeType: 'application/json' }] };
    }
    const paramsM = href.match(/^search:\/\/knowledge\/([^\/]+)\/([^\/]+)$/);
    if (paramsM) {
      const project = decodeURIComponent(paramsM[1]);
      const rawParams = paramsM[2];
      if (!project || !rawParams) {
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'project and params are required' }, null, 2), mimeType: 'application/json' }] };
      }
      let params: any = {};
      try { params = JSON.parse(Buffer.from(ctx.normalizeBase64(rawParams), 'base64').toString('utf8')); }
      catch { try { params = JSON.parse(decodeURIComponent(rawParams)); } catch {} }
      const query: string = String(params.query || '').trim();
      if (!query) {
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'query is required' }, null, 2), mimeType: 'application/json' }] };
      }
      const limit: number = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
      const metas = await listDocs({ project, includeArchived: false } as any);
      const docs = (await Promise.all(metas.map(async (m: any) => await readDoc(project, m.id)))).filter(Boolean) as any[];
      const results = await twoStageHybridKnowledgeSearch(query, docs as unknown as KnowledgeDoc[], { limit, vectorAdapter: await ctx.ensureVectorAdapter() as VectorSearchAdapter<{ doc: KnowledgeDoc; chunkIndex: number }> | undefined });
      return { contents: [{ uri: href, text: JSON.stringify(results, null, 2), mimeType: 'application/json' }] };
    }
    return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'unsupported search://knowledge path' }, null, 2), mimeType: 'application/json' }] };
  };

  try {
    ctx.server.registerResource(
      'search_tasks_recent_tpl',
      ctx.makeResourceTemplate('search://tasks/{project}/recent'),
      { title: 'Search Tasks Recent', description: 'Recent tasks for project', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const project = String(vars?.project || '').trim();
        if (!project) {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ ok: false, error: 'project is required' }, null, 2), mimeType: 'application/json' }] };
        }
        return handleSearchTasksHref(`search://tasks/${encodeURIComponent(project)}/recent`);
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) log.warn('already registered: search://tasks/{project}/recent — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'search_tasks_query_tpl',
      ctx.makeResourceTemplate('search://tasks/{project}/{params}'),
      { title: 'Search Tasks (Semantic)', description: 'Semantic search. params = base64url JSON {"query":"...","limit":N}', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const project = String(vars?.project || '').trim();
        const params = String(vars?.params || '').trim();
        if (!project || !params) {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ ok: false, error: 'project and params are required' }, null, 2), mimeType: 'application/json' }] };
        }
        return handleSearchTasksHref(`search://tasks/${encodeURIComponent(project)}/${encodeURIComponent(params)}`);
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) log.warn('already registered: search://tasks/{project}/{params} — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'search_knowledge_recent_tpl',
      ctx.makeResourceTemplate('search://knowledge/{project}/recent'),
      { title: 'Search Knowledge Recent', description: 'Recent knowledge for project', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const project = String(vars?.project || '').trim();
        if (!project) {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ ok: false, error: 'project is required' }, null, 2), mimeType: 'application/json' }] };
        }
        return handleSearchKnowledgeHref(`search://knowledge/${encodeURIComponent(project)}/recent`);
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) log.warn('already registered: search://knowledge/{project}/recent — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'search_knowledge_query_tpl',
      ctx.makeResourceTemplate('search://knowledge/{project}/{params}'),
      { title: 'Search Knowledge (Semantic)', description: 'Semantic search. params = base64url JSON {"query":"...","limit":N}', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const project = String(vars?.project || '').trim();
        const params = String(vars?.params || '').trim();
        if (!project || !params) {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ ok: false, error: 'project and params are required' }, null, 2), mimeType: 'application/json' }] };
        }
        return handleSearchKnowledgeHref(`search://knowledge/${encodeURIComponent(project)}/${encodeURIComponent(params)}`);
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) log.warn('already registered: search://knowledge/{project}/{params} — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'search_tasks',
      'search://tasks',
      { title: 'Search Tasks', description: 'Dynamic: /{project}/{paramsB64} or /{project}/recent', mimeType: 'application/json' },
      async (u) => {
        return handleSearchTasksHref(u.href);
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) log.warn('already registered: search://tasks — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'search_knowledge',
      'search://knowledge',
      { title: 'Search Knowledge', description: 'Dynamic: /{project}/{paramsB64} or /{project}/recent', mimeType: 'application/json' },
      async (u) => {
        return handleSearchKnowledgeHref(u.href);
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) log.warn('already registered: search://knowledge — skipping'); else throw e; }
}
