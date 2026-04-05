import type { ServerContext } from './context.js';
import { getCurrentProject } from '../config.js';
import { listTasks, listTasksTree, updateTask, closeTask, trashTask, restoreTask, archiveTask } from '../storage/tasks.js';
import { listDocs } from '../storage/knowledge.js';

export function registerAliases(ctx: ServerContext): void {
  try {
    ctx.server.registerResource(
      'tasks_current',
      'tasks://current',
      { title: 'Tasks (Current Project)', description: 'List tasks for the current project', mimeType: 'application/json' },
      async (u) => {
        const prj = getCurrentProject();
        const items = await listTasks({ project: prj, includeArchived: false });
        return { contents: [{ uri: u.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://current — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_current_tree',
      'tasks://current/tree',
      { title: 'Tasks Tree (Current Project)', description: 'Tree of tasks for the current project', mimeType: 'application/json' },
      async (u) => {
        const prj = getCurrentProject();
        const items = await listTasksTree({ project: prj, includeArchived: false });
        return { contents: [{ uri: u.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://current/tree — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_project_dynamic',
      'tasks://project',
      { title: 'Tasks by Project (Dynamic)', description: 'Dynamic: /{id}/tree, /{id}/status/{status}, /{id}/tag/{tag}', mimeType: 'application/json' },
      async (u) => {
        const href = u.href;
        const treeM = href.match(/^tasks:\/\/project\/([^\/]+)\/tree$/);
        if (treeM) {
          const id = decodeURIComponent(treeM[1]);
          const items = await listTasksTree({ project: id, includeArchived: false });
          return { contents: [{ uri: href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
        }
        const statusM = href.match(/^tasks:\/\/project\/([^\/]+)\/status\/([^\/]+)$/);
        if (statusM) {
          const id = decodeURIComponent(statusM[1]);
          const status = decodeURIComponent(statusM[2]);
          const allowed = new Set(['pending','in_progress','completed','closed']);
          if (!allowed.has(status)) return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: `invalid status: ${status}` }, null, 2), mimeType: 'application/json' }] };
          const items = await listTasks({ project: id, status: status as any, includeArchived: false } as any);
          return { contents: [{ uri: href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
        }
        const tagM = href.match(/^tasks:\/\/project\/([^\/]+)\/tag\/([^\/]+)$/);
        if (tagM) {
          const id = decodeURIComponent(tagM[1]);
          const tag = decodeURIComponent(tagM[2]);
          const items = await listTasks({ project: id, tag, includeArchived: false } as any);
          return { contents: [{ uri: href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
        }
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'unsupported tasks://project path' }, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://project — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_project_id_tpl',
      ctx.makeResourceTemplate('tasks://project/{id}'),
      { title: 'Tasks by Project', description: 'List tasks for project by id', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const id = String(vars?.id || '').trim();
        const items = await listTasks({ project: id, includeArchived: false });
        return { contents: [{ uri: uri.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://project/{id} — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_project_tree_tpl',
      ctx.makeResourceTemplate('tasks://project/{id}/tree'),
      { title: 'Tasks Tree by Project', description: 'Tree of tasks for project by id', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const id = String(vars?.id || '').trim();
        const items = await listTasksTree({ project: id, includeArchived: false });
        return { contents: [{ uri: uri.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://project/{id}/tree — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_project_status_tpl',
      ctx.makeResourceTemplate('tasks://project/{id}/status/{status}'),
      { title: 'Tasks by Project (Status)', description: 'List tasks for project filtered by status', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const id = String(vars?.id || '').trim();
        const status = String(vars?.status || '').trim();
        const allowed = new Set(['pending','in_progress','completed','closed']);
        if (!allowed.has(status)) {
          return { contents: [{ uri: uri.href, text: JSON.stringify({ ok: false, error: `invalid status: ${status}` }, null, 2), mimeType: 'application/json' }] };
        }
        const items = await listTasks({ project: id, status: status as any, includeArchived: false } as any);
        return { contents: [{ uri: uri.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://project/{id}/status/{status} — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_project_tag_tpl',
      ctx.makeResourceTemplate('tasks://project/{id}/tag/{tag}'),
      { title: 'Tasks by Project (Tag)', description: 'List tasks for project filtered by tag', mimeType: 'application/json' },
      async (uri: URL, vars: any) => {
        const id = String(vars?.id || '').trim();
        const tag = String(vars?.tag || '').trim();
        const items = await listTasks({ project: id, tag, includeArchived: false } as any);
        return { contents: [{ uri: uri.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://project/{id}/tag/{tag} — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'tasks_action_dynamic',
      'tasks://action',
      { title: 'Tasks Action (Dynamic)', description: 'Dynamic: /{project}/{id}/{start|complete|close|trash|restore|archive} or /{project}/{id}/status/{pending|in_progress|completed|closed}', mimeType: 'application/json' },
      async (u) => {
        const href = u.href;
        const respond = (payload: any) => ({ contents: [{ uri: href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] });

        const actM = href.match(/^tasks:\/\/action\/([^\/]+)\/([^\/]+)\/(start|complete|close|trash|restore|archive)$/);
        if (actM) {
          const project = decodeURIComponent(actM[1]);
          const id = decodeURIComponent(actM[2]);
          const action = actM[3] as 'start'|'complete'|'close'|'trash'|'restore'|'archive';
          try {
            let payload: any = null;
            if (action === 'start') payload = await updateTask(project, id, { status: 'in_progress' } as any);
            else if (action === 'complete') payload = await updateTask(project, id, { status: 'completed' } as any);
            else if (action === 'close') payload = await closeTask(project, id);
            else if (action === 'trash') payload = await trashTask(project, id);
            else if (action === 'restore') payload = await restoreTask(project, id);
            else if (action === 'archive') payload = await archiveTask(project, id);
            return respond({ ok: true, project, id, action, data: payload ?? null });
          } catch (e: any) {
            return respond({ ok: false, project, id, action, error: e?.message || String(e) });
          }
        }

        const stM = href.match(/^tasks:\/\/action\/([^\/]+)\/([^\/]+)\/status\/([^\/]+)$/);
        if (stM) {
          const project = decodeURIComponent(stM[1]);
          const id = decodeURIComponent(stM[2]);
          const value = decodeURIComponent(stM[3]).toLowerCase();
          const allowed = new Map<string, 'pending'|'in_progress'|'completed'|'closed'>([
            ['pending','pending'],['todo','pending'],
            ['in_progress','in_progress'],['inprogress','in_progress'],['working','in_progress'],
            ['completed','completed'],['complete','completed'],['done','completed'],
            ['closed','closed'],['close','closed']
          ]);
          const status = allowed.get(value);
          if (!status) return respond({ ok: false, project, id, error: `invalid status: ${value}` });
          try {
            const payload = await updateTask(project, id, { status } as any);
            return respond({ ok: true, project, id, action: `status:${status}`, data: payload ?? null });
          } catch (e: any) {
            return respond({ ok: false, project, id, action: `status:${value}`, error: e?.message || String(e) });
          }
        }

        return respond({
          ok: false,
          error: 'unsupported tasks://action path',
          examples: [
            'tasks://action/{project}/{id}/start',
            'tasks://action/{project}/{id}/status/pending'
          ]
        });
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: tasks://action — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'knowledge_current',
      'knowledge://current',
      { title: 'Knowledge (Current Project)', description: 'List knowledge for current project', mimeType: 'application/json' },
      async (u) => {
        const prj = getCurrentProject();
        const items = await listDocs({ project: prj, includeArchived: false } as any);
        return { contents: [{ uri: u.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: knowledge://current — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'knowledge_current_tree',
      'knowledge://current/tree',
      { title: 'Knowledge Tree (Current Project)', description: 'Group knowledge by first tag (simple tree)', mimeType: 'application/json' },
      async (u) => {
        const prj = getCurrentProject();
        const items: any[] = await listDocs({ project: prj, includeArchived: false } as any);
        const groups: Record<string, any[]> = {};
        for (const d of items) {
          const t = (Array.isArray(d?.tags) && d.tags.length > 0) ? String(d.tags[0]) : 'untagged';
          (groups[t] ||= []).push(d);
        }
        const tree = Object.keys(groups).sort().map(k => ({ tag: k, items: groups[k] }));
        return { contents: [{ uri: u.href, text: JSON.stringify(tree, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: knowledge://current/tree — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'knowledge_project_dynamic',
      'knowledge://project',
      { title: 'Knowledge by Project (Dynamic)', description: 'Dynamic: /{id}, /{id}/tree, /{id}/tag/{tag}, /{id}/type/{type}', mimeType: 'application/json' },
      async (u) => {
        const href = u.href;
        const listM = href.match(/^knowledge:\/\/project\/([^\/]+)$/);
        if (listM) {
          const id = decodeURIComponent(listM[1]);
          const items = await listDocs({ project: id, includeArchived: false } as any);
          return { contents: [{ uri: href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
        }
        const treeM = href.match(/^knowledge:\/\/project\/([^\/]+)\/tree$/);
        if (treeM) {
          const id = decodeURIComponent(treeM[1]);
          const items: any[] = await listDocs({ project: id, includeArchived: false } as any);
          const groups: Record<string, any[]> = {};
          for (const d of items) { const t = (Array.isArray(d?.tags) && d.tags.length > 0) ? String(d.tags[0]) : 'untagged'; (groups[t] ||= []).push(d); }
          const tree = Object.keys(groups).sort().map(k => ({ tag: k, items: groups[k] }));
          return { contents: [{ uri: href, text: JSON.stringify(tree, null, 2), mimeType: 'application/json' }] };
        }
        const tagM = href.match(/^knowledge:\/\/project\/([^\/]+)\/tag\/([^\/]+)$/);
        if (tagM) {
          const id = decodeURIComponent(tagM[1]);
          const tag = decodeURIComponent(tagM[2]);
          const items: any[] = await listDocs({ project: id, includeArchived: false } as any);
          const filtered = items.filter((d: any) => Array.isArray(d?.tags) && d.tags.includes(tag));
          return { contents: [{ uri: href, text: JSON.stringify(filtered, null, 2), mimeType: 'application/json' }] };
        }
        const typeM = href.match(/^knowledge:\/\/project\/([^\/]+)\/type\/([^\/]+)$/);
        if (typeM) {
          const id = decodeURIComponent(typeM[1]);
          const type = decodeURIComponent(typeM[2]);
          const items: any[] = await listDocs({ project: id, includeArchived: false } as any);
          const filtered = items.filter((d: any) => String(d?.type || '').toLowerCase() === type.toLowerCase());
          return { contents: [{ uri: href, text: JSON.stringify(filtered, null, 2), mimeType: 'application/json' }] };
        }
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'unsupported knowledge://project path' }, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: knowledge://project — skipping'); else throw e; }
}
