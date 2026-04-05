import type { ServerContext } from './context.js';
import { PROMPTS_DIR, resolveProject, getCurrentProject } from '../config.js';
import { listProjects } from '../projects.js';
import { listTasks, getTask, updateTask, closeTask, trashTask, restoreTask, archiveTask } from '../storage/tasks.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { readPromptsCatalog, readPromptBuildItems, findFileByIdVersion as findFileByIdVersionHelper, ensureDirForFile, listFilesRecursive } from './helpers.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';

export function registerResources(ctx: ServerContext) {
  const buildTaskResponder = (baseTitle: string, baseDescription: string) => async (uri: { href: string }) => {
    const url = new URL(uri.href);
    const host = url.hostname;
    const rawPath = url.pathname.replace(/^\/+/, '');
    const pathSegments = rawPath ? rawPath.split('/').filter(Boolean) : [];

    const respond = (payload: Record<string, any>) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }],
    });

    const handleAction = async (projectRaw: string | null, idRaw: string | null, actionRaw: string | null, statusHint?: string | null) => {
      const project = (projectRaw ?? '').trim();
      const id = (idRaw ?? '').trim();
      const actionInput = (actionRaw ?? '').trim();
      if (!project || !id || !actionInput) {
        return respond({ ok: false, error: 'project, id and action are required', example: 'task://action?project=proj&id=uuid&action=start' });
      }

      const action = actionInput.toLowerCase();
      const normalizedStatusHint = statusHint ? statusHint.trim().toLowerCase().replace(/-/g, '_') : undefined;

      const runAndRespond = async (resolver: () => Promise<any>, label: string) => {
        try {
          const data = await resolver();
          if (!data) return respond({ ok: false, project, id, action: label, error: 'task not found' });
          return respond({ ok: true, project, id, action: label, status: data.status ?? null, data });
        } catch (error: any) {
          return respond({ ok: false, project, id, action: label, error: error?.message || String(error) });
        }
      };

      const directActions: Record<string, { label: string; handler: () => Promise<any> }> = {
        start: { label: 'status:in_progress', handler: () => updateTask(project, id, { status: 'in_progress' } as any) },
        in_progress: { label: 'status:in_progress', handler: () => updateTask(project, id, { status: 'in_progress' } as any) },
        progress: { label: 'status:in_progress', handler: () => updateTask(project, id, { status: 'in_progress' } as any) },
        pending: { label: 'status:pending', handler: () => updateTask(project, id, { status: 'pending' } as any) },
        reopen: { label: 'status:pending', handler: () => updateTask(project, id, { status: 'pending' } as any) },
        complete: { label: 'status:completed', handler: () => updateTask(project, id, { status: 'completed' } as any) },
        completed: { label: 'status:completed', handler: () => updateTask(project, id, { status: 'completed' } as any) },
        close: { label: 'status:closed', handler: () => closeTask(project, id) },
        closed: { label: 'status:closed', handler: () => closeTask(project, id) },
        trash: { label: 'trash', handler: () => trashTask(project, id) },
        restore: { label: 'restore', handler: () => restoreTask(project, id) },
        archive: { label: 'archive', handler: () => archiveTask(project, id) },
      };

      const direct = directActions[action];
      if (direct) return runAndRespond(direct.handler, direct.label);

      if (action === 'status' || action === 'set-status' || action === 'set_status') {
        if (!normalizedStatusHint) return respond({ ok: false, project, id, action, error: 'status query parameter is required' });
        const allowedStatuses = new Map<string, 'pending' | 'in_progress' | 'completed' | 'closed'>([
          ['pending', 'pending'], ['todo', 'pending'], ['in_progress', 'in_progress'], ['inprogress', 'in_progress'], ['working', 'in_progress'],
          ['completed', 'completed'], ['complete', 'completed'], ['done', 'completed'], ['closed', 'closed'], ['close', 'closed'],
        ]);
        const resolvedStatus = allowedStatuses.get(normalizedStatusHint);
        if (!resolvedStatus) return respond({ ok: false, project, id, action, error: `unsupported status value: ${normalizedStatusHint}` });
        return runAndRespond(() => updateTask(project, id, { status: resolvedStatus } as any), `status:${resolvedStatus}`);
      }

      return respond({ ok: false, project, id, action, error: 'unsupported action', supported: Object.keys(directActions).concat(['status (with ?status=...)']) });
    };

    const actionFromQuery = url.searchParams.get('action') ?? url.searchParams.get('cmd');
    const statusFromQuery = url.searchParams.get('status') ?? url.searchParams.get('value');

    if ((host === 'tasks' || host === '') && pathSegments.length === 0 && !actionFromQuery) {
      const projectsData = await listProjects(getCurrentProject);
      const allTasks: any[] = [];
      for (const project of projectsData.projects.map((p: any) => p.id)) {
        try {
          const tasks = await listTasks({ project, includeArchived: false });
          for (const task of tasks) {
            allTasks.push({ ...task, uri: `task://${project}/${task.id}`, name: `Task: ${task.title}`, description: `Project: ${project}, Status: ${task.status}, Priority: ${task.priority}`, project });
          }
        } catch {}
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify(allTasks, null, 2), mimeType: 'application/json' }] };
    }

    if (host === 'action') {
      const projectSegment = pathSegments[0] ? decodeURIComponent(pathSegments[0]) : null;
      const idSegment = pathSegments[1] ? decodeURIComponent(pathSegments[1]) : null;
      const actionSegment = pathSegments[2] ? decodeURIComponent(pathSegments[2]) : null;
      const projectParam = url.searchParams.get('project');
      const idParam = url.searchParams.get('id');

      if (!projectSegment && !projectParam && !actionSegment && !actionFromQuery) {
        return respond({ ok: false, error: 'invalid task action request', examples: ['task://action?project=proj&id=uuid&action=start', 'task://action?project=proj&id=uuid&action=status&status=pending', 'task://action/{project}/{id}/{start|complete|close|trash|restore|archive}'] });
      }

      return handleAction(projectSegment ?? projectParam, idSegment ?? idParam, actionSegment ?? actionFromQuery, statusFromQuery);
    }

    if ((host === 'tasks' || host === '') && actionFromQuery) {
      return handleAction(url.searchParams.get('project'), url.searchParams.get('id'), actionFromQuery, statusFromQuery);
    }

    if (host && pathSegments.length >= 2) {
      const project = decodeURIComponent(host);
      const taskId = decodeURIComponent(pathSegments[0]);
      let actionSegment = decodeURIComponent(pathSegments[1]);
      if (actionSegment.toLowerCase() === 'action') {
        if (pathSegments.length < 3) return respond({ ok: false, error: 'missing action after /action segment', example: `task://${project}/${taskId}/action/start` });
        actionSegment = decodeURIComponent(pathSegments[2]);
      }
      return handleAction(project, taskId, actionSegment, statusFromQuery);
    }

    if (!host) return respond({ ok: false, error: 'Invalid task URI: missing project segment' });
    if (pathSegments.length === 0) return respond({ ok: false, error: 'Invalid task URI format. Expected: task://{project}/{id}' });

    const project = decodeURIComponent(host);
    const id = decodeURIComponent(pathSegments.join('/'));
    const task = await getTask(project, id);
    return { contents: [{ uri: uri.href, text: JSON.stringify(task, null, 2), mimeType: 'application/json' }] };
  };

  const taskResourceHandler = buildTaskResponder("Task Resources", "Read tasks via task://{project}/{id}. Supported actions: start|in_progress|pending|complete|close|trash|restore|archive via task://{project}/{id}/action/{action} or task://action?...");

  ctx.server.registerResource("tasks", "task://tasks", { title: "Task Resources", description: "List all tasks. Read single task: task://<project>/<id>. Execute actions: task://<project>/<id>/action/{start|in_progress|pending|complete|close|trash|restore|archive}", mimeType: "application/json" }, taskResourceHandler);

  ctx.server.registerResource("task_action", "task://action", { title: "Task Actions", description: "Actions via path: task://action/<project>/<id>/{start|complete|close|...}. Query template also available: task://action{?project,id,action,status}", mimeType: "application/json" }, taskResourceHandler);

  ctx.server.registerResource("task_action_query_tpl", ctx.makeResourceTemplate("task://action{?project,id,action,status}"), { title: "Task Action (Query Template)", description: "Examples: task://action?project=<project>&id=<id>&action=start; task://action?project=<project>&id=<id>&action=status&status=completed", mimeType: "application/json" }, async (uri: URL, vars: any) => {
    const respond = (payload: any) => ({ contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] });
    const project = String(vars?.project ?? '').trim();
    const id = String(vars?.id ?? '').trim();
    const action = String(vars?.action ?? '').trim().toLowerCase();
    const status = String(vars?.status ?? '').trim().toLowerCase().replace(/-/g, '_');
    if (!project || !id || !action) return respond({ ok: false, error: 'project, id and action are required' });
    try {
      if (action === 'status' || action === 'set-status' || action === 'set_status') {
        const allowed = new Map<string, 'pending'|'in_progress'|'completed'|'closed'>([['pending','pending'], ['todo','pending'], ['in_progress','in_progress'], ['inprogress','in_progress'], ['working','in_progress'], ['completed','completed'], ['complete','completed'], ['done','completed'], ['closed','closed'], ['close','closed']]);
        const st = allowed.get(status);
        if (!st) return respond({ ok: false, project, id, action: 'status', error: `invalid status: ${vars?.status ?? ''}` });
        const data = await updateTask(project, id, { status: st } as any);
        return respond({ ok: true, project, id, action: `status:${st}`, data });
      }
      let data: any = null;
      if (['start','in_progress','progress'].includes(action)) data = await updateTask(project, id, { status: 'in_progress' } as any);
      else if (['pending','reopen'].includes(action)) data = await updateTask(project, id, { status: 'pending' } as any);
      else if (['complete','completed','done'].includes(action)) data = await updateTask(project, id, { status: 'completed' } as any);
      else if (['close','closed'].includes(action)) data = await closeTask(project, id);
      else if (action === 'trash') data = await trashTask(project, id);
      else if (action === 'restore') data = await restoreTask(project, id);
      else if (action === 'archive') data = await archiveTask(project, id);
      else return respond({ ok: false, project, id, action, error: 'unsupported action' });
      return respond({ ok: true, project, id, action, data });
    } catch (e: any) { return respond({ ok: false, project, id, action, error: e?.message || String(e) }); }
  });

  ctx.server.registerResource("task_action_status_tpl", ctx.makeResourceTemplate("task://action/{project}/{id}/status/{value}"), { title: "Task Action (Status Path)", description: "Status path: task://action/<project>/<id>/status/{pending|in_progress|completed|closed}", mimeType: "application/json" }, async (uri: URL, vars: any) => {
    const respond = (payload: any) => ({ contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] });
    const project = String(vars?.project ?? '').trim();
    const id = String(vars?.id ?? '').trim();
    const raw = String(vars?.value ?? '').trim().toLowerCase().replace(/-/g, '_');
    if (!project || !id || !raw) return respond({ ok: false, error: 'project, id and status value are required' });
    const map = new Map<string, 'pending'|'in_progress'|'completed'|'closed'>([['pending','pending'], ['todo','pending'], ['in_progress','in_progress'], ['inprogress','in_progress'], ['working','in_progress'], ['completed','completed'], ['complete','completed'], ['done','completed'], ['closed','closed'], ['close','closed']]);
    const status = map.get(raw);
    if (!status) return respond({ ok: false, project, id, error: `invalid status: ${raw}` });
    try {
      const data = await updateTask(project, id, { status } as any);
      return respond({ ok: true, project, id, action: `status:${status}`, data });
    } catch (e: any) { return respond({ ok: false, project, id, action: `status:${raw}`, error: e?.message || String(e) }); }
  });

  ctx.server.registerResource("task_action_path_tpl", ctx.makeResourceTemplate("task://action/{project}/{id}/{action}"), { title: "Task Action (Path Template)", description: "Path actions: task://action/<project>/<id>/{start|pending|complete|close|trash|restore|archive}", mimeType: "application/json" }, async (uri: URL, vars: any) => {
    const respond = (payload: any) => ({ contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] });
    const project = String(vars?.project ?? '').trim();
    const id = String(vars?.id ?? '').trim();
    const action = String(vars?.action ?? '').trim().toLowerCase();
    if (!project || !id || !action) return respond({ ok: false, error: 'project, id and action are required' });
    try {
      let data: any = null;
      if (['start','in_progress','progress'].includes(action)) data = await updateTask(project, id, { status: 'in_progress' } as any);
      else if (['pending','reopen'].includes(action)) data = await updateTask(project, id, { status: 'pending' } as any);
      else if (['complete','completed','done'].includes(action)) data = await updateTask(project, id, { status: 'completed' } as any);
      else if (['close','closed'].includes(action)) data = await closeTask(project, id);
      else if (action === 'trash') data = await trashTask(project, id);
      else if (action === 'restore') data = await restoreTask(project, id);
      else if (action === 'archive') data = await archiveTask(project, id);
      else return respond({ ok: false, project, id, action, error: 'unsupported action' });
      return respond({ ok: true, project, id, action, data });
    } catch (e: any) { return respond({ ok: false, project, id, action, error: e?.message || String(e) }); }
  });

  ctx.server.registerResource("task_item_action_tpl", ctx.makeResourceTemplate("task://{project}/{id}/action/{action}"), { title: "Task Item Action", description: "Preferred path form. Example: task://<project>/<id>/action/start (supports same verbs as task://action/...)", mimeType: "application/json" }, async (uri: URL, vars: any) => {
    const respond = (payload: any) => ({ contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] });
    const project = String(vars?.project ?? '').trim();
    const id = String(vars?.id ?? '').trim();
    const action = String(vars?.action ?? '').trim().toLowerCase();
    if (!project || !id || !action) return respond({ ok: false, error: 'project, id and action are required' });
    try {
      let data: any = null;
      if (['start','in_progress','progress'].includes(action)) data = await updateTask(project, id, { status: 'in_progress' } as any);
      else if (['pending','reopen'].includes(action)) data = await updateTask(project, id, { status: 'pending' } as any);
      else if (['complete','completed','done'].includes(action)) data = await updateTask(project, id, { status: 'completed' } as any);
      else if (['close','closed'].includes(action)) data = await closeTask(project, id);
      else if (action === 'trash') data = await trashTask(project, id);
      else if (action === 'restore') data = await restoreTask(project, id);
      else if (action === 'archive') data = await archiveTask(project, id);
      else return respond({ ok: false, project, id, action, error: 'unsupported action' });
      return respond({ ok: true, project, id, action, data });
    } catch (e: any) { return respond({ ok: false, project, id, action, error: e?.message || String(e) }); }
  });

  ctx.server.registerResource("task_router_prefix", "task://", { title: "Task Prefix Handler", description: "Handles task://{project}/{id}[/{action}] URIs (use project name as host)", mimeType: "application/json" }, taskResourceHandler);

  ctx.server.registerResource("knowledge", "knowledge://docs", { title: "Knowledge Resources", description: "Access individual knowledge documents by project and ID", mimeType: "application/json" }, async (uri) => {
    if (uri.href === "knowledge://docs") {
      const projectsData = await listProjects(getCurrentProject);
      const allDocs: any[] = [];
      for (const project of projectsData.projects.map((p: any) => p.id)) {
        try {
          const docs = await listDocs({ project, includeArchived: false });
          for (const doc of docs) {
            allDocs.push({ ...doc, uri: `knowledge://${project}/${doc.id}`, name: `Knowledge: ${doc.title}`, description: `Project: ${project}, Type: ${doc.type || 'document'}, Tags: ${(doc.tags || []).join(', ')}`, project });
          }
        } catch {}
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify(allDocs, null, 2), mimeType: "application/json" }] };
    }
    const match = uri.href.match(/^knowledge:\/\/([^\/]+)\/(.+)$/);
    if (!match) throw new Error("Invalid knowledge URI format. Expected: knowledge://{project}/{id}");
    const [, project, id] = match;
    const doc = await readDoc(project, id);
    return { contents: [{ uri: uri.href, text: JSON.stringify(doc, null, 2), mimeType: "application/json" }] };
  });

  async function findFileByIdVersion(project: string, id: string, version: string): Promise<string | null> {
    const files = await findFileByIdVersionHelper(project);
    for (const f of files) {
      try {
        const raw = await fs.readFile(f, 'utf8');
        const j = JSON.parse(raw);
        if (j && j.id === id && j.version === version) return f;
      } catch {}
    }
    return null;
  }

  async function findFileByIdVersionHelper(project: string): Promise<string[]> {
    const base = path.join(PROMPTS_DIR, project);
    const dirs = ['prompts', 'rules', 'workflows', 'templates', 'policies'].map((d) => path.join(base, d));
    const out: string[] = [];
    for (const d of dirs) {
      let entries: Dirent[] = [];
      try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.json')) continue;
        out.push(path.join(d, e.name));
      }
    }
    return out;
  }

  ctx.server.registerResource("prompts", "prompt://catalog", { title: "Prompt Resources", description: "Access individual prompts by project, ID and version", mimeType: "application/json" }, async (uri) => {
    if (uri.href === "prompt://catalog") {
      const projectsData = await listProjects(getCurrentProject);
      const allPrompts: any[] = [];
      for (const project of projectsData.projects.map((p: any) => p.id)) {
        try {
          const catalog = await readPromptsCatalog(project);
          for (const [key, meta] of Object.entries<any>(catalog?.items || {})) {
            const version = meta.version || meta.buildVersion || 'latest';
            allPrompts.push({ ...meta, uri: `prompt://${project}/${key}@${version}`, name: `Prompt: ${meta.title || key}`, description: `Project: ${project}, Kind: ${meta.kind || 'prompt'}, Domain: ${meta.domain}, Status: ${meta.status}`, project, key, version });
          }
        } catch {}
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify(allPrompts, null, 2), mimeType: "application/json" }] };
    }
    const match = uri.href.match(/^prompt:\/\/([^\/]+)\/([^@]+)@(.+)$/);
    if (!match) throw new Error("Invalid prompt URI format. Expected: prompt://{project}/{id}@{version}");
    const [, project, id, version] = match;
    const filePath = await findFileByIdVersion(project, id, version);
    if (!filePath) throw new Error(`Prompt not found: ${id}@${version} in project ${project}`);
    const content = await fs.readFile(filePath, 'utf8');
    const prompt = JSON.parse(content);
    return { contents: [{ uri: uri.href, text: JSON.stringify(prompt, null, 2), mimeType: "application/json" }] };
  });

  ctx.server.registerResource("exports", "export://files", { title: "Export Resources", description: "Access exported prompt artifacts and files", mimeType: "application/json" }, async (uri) => {
    if (uri.href === "export://files") {
      const projectsData = await listProjects(getCurrentProject);
      const allExports: any[] = [];
      for (const project of projectsData.projects.map((p: any) => p.id)) {
        try {
          const base = path.join(PROMPTS_DIR, project, 'exports');
          const types = ['builds', 'catalog', 'json', 'markdown'];
          for (const type of types) {
            try {
              const typeDir = path.join(base, type);
              const files = await listFilesRecursive(typeDir);
              for (const filePath of files) {
                const relativePath = path.relative(typeDir, filePath);
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                let mimeType = "text/plain";
                if (ext === '.json') mimeType = "application/json";
                else if (ext === '.md') mimeType = "text/markdown";
                allExports.push({ uri: `export://${project}/${type}/${relativePath}`, name: `Export: ${fileName}`, description: `Project: ${project}, Type: ${type}, Path: ${relativePath}`, project, type, filename: relativePath, mimeType });
              }
            } catch {}
          }
        } catch {}
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify(allExports, null, 2), mimeType: "application/json" }] };
    }
    const match = uri.href.match(/^export:\/\/([^\/]+)\/([^\/]+)\/(.+)$/);
    if (!match) throw new Error("Invalid export URI format. Expected: export://{project}/{type}/{filename}");
    const [, project, type, filename] = match;
    const filePath = path.join(PROMPTS_DIR, project, 'exports', type, filename);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = "text/plain";
      if (ext === '.json') mimeType = "application/json";
      else if (ext === '.md') mimeType = "text/markdown";
      return { contents: [{ uri: uri.href, text: content, mimeType }] };
    } catch (error: any) { throw new Error(`Failed to read export file: ${error.message}`); }
  });

  if (ctx.TOOL_RES_ENABLED) ctx.server.registerResource("tools_catalog", "tool://catalog", { title: "Tools Catalog", description: "List registered tools and their metadata", mimeType: "application/json" }, async (uri) => {
    const items = Array.from(ctx.toolRegistry.entries()).map(([name, meta]) => ({ name, title: meta.title ?? null, description: meta.description ?? null, inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [] }));
    return { contents: [{ uri: uri.href, text: JSON.stringify({ total: items.length, items }, null, 2), mimeType: "application/json" }] };
  });

  if (ctx.TOOL_RES_ENABLED) ctx.server.registerResource("tools_schema", "tool://schema", { title: "Tool Schema", description: "Read-only metadata for tools (use tools.run to execute)", mimeType: "application/json" }, async (uri) => {
    const href = uri.href;
    const m = href.match(/^tool:\/\/schema\/?([^\/?#]+)?/);
    const name = m && m[1] ? decodeURIComponent(m[1]) : undefined;
    if (!name) {
      const items = Array.from(ctx.toolRegistry.keys());
      return { contents: [{ uri: href, text: JSON.stringify({ error: 'name required', available: items }, null, 2), mimeType: "application/json" }] };
    }
    const meta = ctx.toolRegistry.get(name);
    if (!meta) return { contents: [{ uri: href, text: JSON.stringify({ error: `Tool not found: ${name}` }, null, 2), mimeType: "application/json" }] };
    const payload = { name, title: meta.title ?? null, description: meta.description ?? null, inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [] };
    return { contents: [{ uri: href, text: JSON.stringify(payload, null, 2), mimeType: "application/json" }] };
  });
}