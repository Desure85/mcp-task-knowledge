import type { ServerContext } from './context.js';
import { PROMPTS_DIR, getCurrentProject } from '../config.js';
import { listProjects } from '../projects.js';
import { listTasks, getTask } from '../storage/tasks.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { readPromptsCatalog, listFilesRecursive } from './helpers.js';
import { resolveUnder, resolveUnderPath } from '../fs.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';

const ACTIONS_HINT =
  'task mutations are tools-only (tasks_update/tasks_close/...). Resource reads never mutate state (AUD-02)';

export function registerResources(ctx: ServerContext) {
  const buildTaskResponder = (_baseTitle: string, _baseDescription: string) => async (uri: { href: string }) => {
    const url = new URL(uri.href);
    const host = url.hostname;
    const rawPath = url.pathname.replace(/^\/+/, '');
    const pathSegments = rawPath ? rawPath.split('/').filter(Boolean) : [];

    const respond = (payload: Record<string, any>) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }],
    });

    const actionFromQuery = url.searchParams.get('action') ?? url.searchParams.get('cmd');

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

    // AUD-02: action URIs used to mutate state through a read endpoint.
    // Reject every action-shaped URI; mutations live behind gated tools.
    if (host === 'action' || actionFromQuery) {
      return respond({ ok: false, error: 'task actions removed from resources', hint: ACTIONS_HINT });
    }

    if (host && pathSegments.length >= 2) {
      return respond({ ok: false, error: 'unsupported task URI', hint: `read a task via task://{project}/{id}; ${ACTIONS_HINT}` });
    }

    if (!host) return respond({ ok: false, error: 'Invalid task URI: missing project segment' });
    if (pathSegments.length === 0) return respond({ ok: false, error: 'Invalid task URI format. Expected: task://{project}/{id}' });

    const project = decodeURIComponent(host);
    const id = decodeURIComponent(pathSegments.join('/'));
    const task = await getTask(project, id);
    return { contents: [{ uri: uri.href, text: JSON.stringify(task, null, 2), mimeType: 'application/json' }] };
  };

  const taskResourceHandler = buildTaskResponder("Task Resources", "Read tasks via task://{project}/{id}. Read-only: mutations are exposed as tools (tasks_update, tasks_close, ...).");

  // AUD-02: former mutation URIs stay registered but only REFUSE — an
  // explicit { ok:false, hint } envelope is more useful to agents than a
  // bare "resource not found" (they are told which tool to call instead).
  const refuse = async (uri: URL | { href: string }) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({ ok: false, error: 'task actions removed from resources', hint: ACTIONS_HINT }, null, 2),
      mimeType: 'application/json',
    }],
  });

  ctx.server.registerResource("task_action", "task://action", { title: "Task Actions (removed)", description: `Removed — ${ACTIONS_HINT}`, mimeType: "application/json" }, refuse);
  ctx.server.registerResource("task_action_query_tpl", ctx.makeResourceTemplate("task://action{?project,id,action,status}"), { title: "Task Action Query (removed)", description: `Removed — ${ACTIONS_HINT}`, mimeType: "application/json" }, refuse);
  ctx.server.registerResource("task_action_status_tpl", ctx.makeResourceTemplate("task://action/{project}/{id}/status/{value}"), { title: "Task Status Action (removed)", description: `Removed — ${ACTIONS_HINT}`, mimeType: "application/json" }, refuse);
  ctx.server.registerResource("task_action_path_tpl", ctx.makeResourceTemplate("task://action/{project}/{id}/{action}"), { title: "Task Action Path (removed)", description: `Removed — ${ACTIONS_HINT}`, mimeType: "application/json" }, refuse);
  ctx.server.registerResource("task_item_action_tpl", ctx.makeResourceTemplate("task://{project}/{id}/action/{action}"), { title: "Task Item Action (removed)", description: `Removed — ${ACTIONS_HINT}`, mimeType: "application/json" }, refuse);

  ctx.server.registerResource("tasks", "task://tasks", { title: "Task Resources", description: "List all tasks (task://tasks) or read one: task://<project>/<id>. Read-only — mutations are tools (AUD-02).", mimeType: "application/json" }, taskResourceHandler);

  ctx.server.registerResource("task_item", ctx.makeResourceTemplate("task://{project}/{id}"), { title: "Task Item", description: "Read a single task: task://<project>/<id>", mimeType: "application/json" }, async (uri: URL, vars: any) => {
    const respond = (payload: any) => ({ contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] });
    const project = String(vars?.project ?? '').trim();
    const id = String(vars?.id ?? '').trim();
    if (!project || !id) return respond({ ok: false, error: 'project and id are required' });
    const task = await getTask(project, id);
    if (!task) return respond({ ok: false, error: 'task not found', project, id });
    return { contents: [{ uri: uri.href, text: JSON.stringify(task, null, 2), mimeType: 'application/json' }] };
  });

  ctx.server.registerResource("task_router_prefix", "task://", { title: "Task Prefix Handler", description: "Read task://{project}/{id} URIs (use project name as host). Read-only.", mimeType: "application/json" }, taskResourceHandler);

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
    const base = resolveUnder(PROMPTS_DIR, project);
    const dirs = ['prompts', 'rules', 'workflows', 'templates', 'policies'].map((d) => path.join(base, d));
    const out: string[] = [];
    for (const d of dirs) {
      let entries: Dirent[];
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

  const EXPORT_TYPES = new Set(['builds', 'catalog', 'json', 'markdown']);

  ctx.server.registerResource("exports", "export://files", { title: "Export Resources", description: "Access exported prompt artifacts and files", mimeType: "application/json" }, async (uri) => {
    if (uri.href === "export://files") {
      const projectsData = await listProjects(getCurrentProject);
      const allExports: any[] = [];
      for (const project of projectsData.projects.map((p: any) => p.id)) {
        try {
          const base = resolveUnder(PROMPTS_DIR, project, 'exports');
          for (const type of EXPORT_TYPES) {
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
    if (!EXPORT_TYPES.has(type)) {
      throw new Error(`Invalid export type '${type}'. Expected one of: ${Array.from(EXPORT_TYPES).join(', ')}`);
    }
    // AUD-03: filename is user-controlled and may contain subdirs — validate
    // every component, then prove the resolved path stays inside exports/.
    const filePath = resolveUnderPath(
      resolveUnder(PROMPTS_DIR, project, 'exports', type),
      decodeURIComponent(filename),
    );
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
      const items = ctx.toolRegistry.names();
      return { contents: [{ uri: href, text: JSON.stringify({ error: 'name required', available: items }, null, 2), mimeType: "application/json" }] };
    }
    const meta = ctx.toolRegistry.get(name);
    if (!meta) return { contents: [{ uri: href, text: JSON.stringify({ error: `Tool not found: ${name}` }, null, 2), mimeType: "application/json" }] };
    const payload = { name, title: meta.title ?? null, description: meta.description ?? null, inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [] };
    return { contents: [{ uri: href, text: JSON.stringify(payload, null, 2), mimeType: "application/json" }] };
  });
}
