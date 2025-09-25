import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { spawn } from 'node:child_process';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_PROJECT, loadConfig, resolveProject, getCurrentProject, setCurrentProject, loadCatalogConfig, TASKS_DIR, KNOWLEDGE_DIR, isCatalogEnabled, isCatalogReadEnabled, isCatalogWriteEnabled, PROMPTS_DIR, isPromptsBuildEnabled, isToolsEnabled, isToolResourcesEnabled, isToolResourcesExecEnabled } from "./config.js";
import { createServiceCatalogProvider } from "./catalog/provider.js";
import { createTask, listTasks, updateTask, closeTask, listTasksTree, archiveTask, trashTask, restoreTask, deleteTaskPermanent, getTask } from "./storage/tasks.js";
import { createDoc, listDocs, readDoc, updateDoc, archiveDoc, trashDoc, restoreDoc, deleteDocPermanent } from "./storage/knowledge.js";
import { buildTextForDoc, buildTextForTask, hybridSearch, twoStageHybridKnowledgeSearch } from "./search/index.js";
import { getVectorAdapter } from "./search/vector.js";
import { exportProjectToVault, planExportProjectToVault } from "./obsidian/export.js";
import { importProjectFromVault, planImportProjectFromVault } from "./obsidian/import.js";
import { listProjects } from "./projects.js";
import { appendAssignments, appendEvents, listBuildVariants, readAggregates, readExperiment, updateAggregates } from './ab-testing/storage.js';
import { pickWithEpsilonGreedy } from './ab-testing/bandits.js';
import { buildWorkflows } from './prompts/build.js';
import { json, ok, err } from './utils/respond.js';

async function main() {
  // Resolve repository root early to read package version and for later utilities
  const HERE_DIR = path.dirname(new URL(import.meta.url).pathname);
  const REPO_ROOT = path.resolve(HERE_DIR, '..');
  async function getPackageVersion(): Promise<string> {
    // Prefer npm-provided env when available (works in npm/yarn/pnpm scripts)
    const vEnv = process.env.npm_package_version;
    if (vEnv && typeof vEnv === 'string') return vEnv;
    // Fallback: read package.json next to repo root
    try {
      const raw = await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8');
      const v = JSON.parse(raw)?.version;
      return typeof v === 'string' ? v : '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
  const version = await getPackageVersion();
  const server = new McpServer({ name: "mcp-task-knowledge", version });
  // Default: silent. Enable explicitly via env.
  const SHOW_STARTUP = (
    process.env.LOG_STARTUP === '1' ||
    process.env.STARTUP_SILENT === '0' ||
    process.env.QUIET === '0' ||
    process.env.LOG_LEVEL === 'info' ||
    process.env.LOG_LEVEL === 'debug'
  );
  if (SHOW_STARTUP) {
    console.error('[startup] mcp-task-knowledge starting...', { ts: new Date().toISOString(), pid: process.pid });
  }
  let cfg: ReturnType<typeof loadConfig>;
  try {
    cfg = loadConfig();
  } catch (e: any) {
    console.error('[startup][config] loadConfig failed. Ensure DATA_DIR and OBSIDIAN_VAULT_ROOT are set. Error:', e?.message || String(e));
    throw e;
  }
  const catalogCfg = loadCatalogConfig();
  if (SHOW_STARTUP) {
    console.error('[startup][catalog]', { mode: catalogCfg.mode, prefer: catalogCfg.prefer, remoteEnabled: catalogCfg.remote.enabled, hasRemoteBaseUrl: Boolean(catalogCfg.remote.baseUrl), embeddedEnabled: catalogCfg.embedded.enabled, embeddedStore: catalogCfg.embedded.store });
  }
  const catalogProvider = createServiceCatalogProvider(catalogCfg);
  // Feature flags for tools and tools-as-resources
  const TOOLS_ENABLED = isToolsEnabled();
  const TOOL_RES_ENABLED = isToolResourcesEnabled();
  const TOOL_RES_EXEC = isToolResourcesExecEnabled();
  if (SHOW_STARTUP) {
    console.error('[startup][embeddings]', { mode: cfg.embeddings.mode, hasModelPath: Boolean(cfg.embeddings.modelPath), dim: cfg.embeddings.dim ?? null, cacheDir: cfg.embeddings.cacheDir || null });
    console.error('[startup][tools]', { toolsEnabled: TOOLS_ENABLED, toolResourcesEnabled: TOOL_RES_ENABLED, toolResourcesExec: TOOL_RES_EXEC });
  }
  // LAZY: Vector adapter is initialized only on first use to avoid ORT teardown crashes
  let vectorAdapter: any | undefined;
  let vectorInitAttempted = false;
  async function ensureVectorAdapter(): Promise<any | undefined> {
    if (vectorAdapter) return vectorAdapter;
    if (vectorInitAttempted) return undefined;
    vectorInitAttempted = true;
    // Pre-check config to provide actionable diagnostics
    try {
      const mode = cfg.embeddings.mode;
      if (mode === 'none') {
        console.warn('[embeddings] EMBEDDINGS_MODE=none — vector adapter disabled');
        return undefined;
      }
      if (!cfg.embeddings.modelPath || !cfg.embeddings.dim) {
        console.warn('[embeddings] Missing modelPath or dim; set EMBEDDINGS_MODEL_PATH and EMBEDDINGS_DIM');
      }
    } catch {}
    try {
      vectorAdapter = await getVectorAdapter<any>();
      if (vectorAdapter && typeof (vectorAdapter as any).info === 'function') {
        try {
          const info = await (vectorAdapter as any).info();
          console.error('[embeddings] adapter initialized', info);
        } catch {}
      } else if (!vectorAdapter) {
        console.warn('[embeddings] adapter not initialized (getVectorAdapter returned undefined)');
      }
      return vectorAdapter;
    } catch (e) {
      console.error('[embeddings] vector adapter init failed:', e);
      return undefined;
    }
  }

  // Simple in-memory registry of tools for introspection and execution (no aliases)
  const toolRegistry: Map<string, { title?: string; description?: string; inputSchema?: Record<string, any>; handler?: (params: any) => Promise<any> }> = new Map();

  function normalizeBase64(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    return normalized + '='.repeat(padding);
  }

  // Unified response helpers imported from utils/respond

  // Сделать регистрацию инструментов идемпотентной, чтобы не падать при повторном старте/горячей перезагрузке
  // и попытке повторной регистрации того же имени инструмента в одном процессе.
  // Патчим метод registerTool так, чтобы молча игнорировать ошибку "already registered".
  const toolNames = new Set<string>();
  const STRICT_TOOL_DEDUP = process.env.MCP_STRICT_TOOL_DEDUP === '1';
  // Helper: register each tool as a dedicated resource tool://{name}
  function registerToolAsResource(name: string) {
    if (name.includes('bulk') || name === 'tools_run') {
      return;
    }
    const baseUri = `tool://${encodeURIComponent(name)}`;
    try {
      server.registerResource(
        `tool_${name}`,
        baseUri,
        {
          title: `Tool: ${name}`,
          description: `Resource wrapper for tool ${name}. Read base URI to get schema. Execution must be done via tools.run RPC (not a resource).`,
          mimeType: "application/json",
        },
        async (uri) => {
          const href = uri.href;
          // tool://{name} or tool://{name}/schema
          const schemaMatch = href.match(/^tool:\/\/([^\/?#]+)(?:\/schema)?$/);
          if (schemaMatch && decodeURIComponent(schemaMatch[1]) === name) {
            const meta = toolRegistry.get(name);
            if (!meta) {
              return { contents: [{ uri: href, text: JSON.stringify({ error: `Tool not found: ${name}` }, null, 2), mimeType: 'application/json' }] };
            }
            const payload = {
              name,
              title: meta.title ?? null,
              description: meta.description ?? null,
              inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
            };
            return { contents: [{ uri: href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] };
          }
          // Otherwise help
          return { contents: [{ uri: href, text: JSON.stringify({ error: 'invalid tool resource path', examples: [`${baseUri}`, `${baseUri}/schema`] }, null, 2), mimeType: 'application/json' }] };
        }
      );
      // Note: execution via resource is intentionally not supported. Use tools.run.
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (typeof msg === 'string' && msg.includes('already registered')) {
        console.warn(`[resources] already registered for tool resource: ${name} — skipping`);
      } else {
        throw e;
      }
    }
  }
  (server as any).registerTool = ((orig: any) => {
    // Expose original registerTool to allow forced registration of core tools
    (server as any)._registerToolOrig = orig;
    return function (name: string, def: any, handler: any) {
      // Явная проверка дубликатов до вызова оригинального метода
      if (toolNames.has(name)) {
        const msg = `[tools] duplicate tool registration detected: "${name}"`;
        if (STRICT_TOOL_DEDUP) {
          throw new Error(msg + ' (MCP_STRICT_TOOL_DEDUP=1)');
        } else {
          console.warn(msg + ' — skipping re-registration');
          // Обновим метаданные для introspection и тихо пропустим повтор
          try {
            toolRegistry.set(name, {
              title: def?.title,
              description: def?.description,
              inputSchema: def?.inputSchema,
              handler,
            });
            // Idempotent: attempt to register resource too (respect flag)
            if (TOOL_RES_ENABLED) registerToolAsResource(name);
          } catch {}
          return;
        }
      }

      // If classic tools are disabled, register only core introspection tools via SDK; others keep registry only
      if (!TOOLS_ENABLED && !['tools_list','tool_schema','tool_help','tools_run'].includes(name)) {
        toolNames.add(name);
        try {
          toolRegistry.set(name, {
            title: def?.title,
            description: def?.description,
            inputSchema: def?.inputSchema,
            handler,
          });
          if (TOOL_RES_ENABLED) registerToolAsResource(name);
        } catch {}
        return;
      }

      try {
        const res = orig.call(server, name, def, handler);
        // Если регистрация прошла — считаем имя занятым
        toolNames.add(name);
        try {
          // Best-effort: keep minimal metadata for introspection
          toolRegistry.set(name, {
            title: def?.title,
            description: def?.description,
            inputSchema: def?.inputSchema,
            handler,
          });
          // Also expose tool as a resource (respect flag)
          if (TOOL_RES_ENABLED) registerToolAsResource(name);
        } catch {}
        return res;
      } catch (e: any) {
        if (e && typeof e.message === 'string' && e.message.includes('already registered')) {
          // Совместимость: некоторые окружения могут вызывать регистрацию повторно — игнорируем
          console.warn(`[tools] SDK reported already registered for "${name}" — skipping`);
          // Зафиксируем имя и метаданные, чтобы introspection была консистентной
          toolNames.add(name);
          try {
            toolRegistry.set(name, {
              title: def?.title,
              description: def?.description,
              inputSchema: def?.inputSchema,
              handler,
            });
          } catch {}
          return;
        }
        throw e;
      }
    };
  })((server as any).registerTool);

  // ===== Helpers: Prompt Library IO =====
  async function readPromptsCatalog(project?: string): Promise<any | null> {
    const prj = resolveProject(project);
    const file = path.join(PROMPTS_DIR, prj, 'exports', 'catalog', 'prompts.catalog.json');
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function readPromptBuildItems(project?: string): Promise<Array<{ id: string; text: string; item: any }>> {
    const prj = resolveProject(project);
    const buildsDir = path.join(PROMPTS_DIR, prj, 'exports', 'builds');
    const mdDir = buildsDir; // md files can live alongside json builds per export
    const out: Array<{ id: string; text: string; item: any }> = [];
    let entries: Dirent[] = [];
    try { entries = await fs.readdir(buildsDir, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(buildsDir, e.name);
      if (e.name.endsWith('.json')) {
        try {
          const raw = await fs.readFile(full, 'utf8');
          const j = JSON.parse(raw);
          const key = e.name.slice(0, -5);
          const text = [j.title, j.description, Array.isArray(j.tags) ? j.tags.join(' ') : '', JSON.stringify(j)].filter(Boolean).join('\n');
          out.push({ id: key, text, item: { key, kind: j.kind || j.type || 'prompt', tags: j.tags || [], title: j.title || key, path: full } });
        } catch {}
      } else if (e.name.endsWith('.md')) {
        try {
          const raw = await fs.readFile(full, 'utf8');
          const key = e.name.slice(0, -3);
          out.push({ id: key, text: raw, item: { key, kind: 'markdown', tags: [], title: key, path: full } });
        } catch {}
      }
    }
    // Optionally read exported markdown dir if exists
    try {
      const mdEntries: Dirent[] = await fs.readdir(mdDir, { withFileTypes: true });
      for (const e of mdEntries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          const full = path.join(mdDir, e.name);
          const raw = await fs.readFile(full, 'utf8');
          const key = e.name.slice(0, -3);
          out.push({ id: key, text: raw, item: { key, kind: 'markdown', tags: [], title: key, path: full } });
        }
      }
    } catch {}
    return out;
  }

  // ===== Helpers: JSONL and filesystem for Prompt Feedback/Exports =====
  async function ensureDirForFile(filePath: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    } catch {}
  }

  async function appendJsonl(filePath: string, items: any[]): Promise<number> {
    await ensureDirForFile(filePath);
    const lines = items.map((x) => JSON.stringify(x)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf8');
    return items.length;
  }

  async function readJsonl(filePath: string): Promise<any[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const out: any[] = [];
      for (const l of lines) {
        try { out.push(JSON.parse(l)); } catch {}
      }
      return out;
    } catch {
      return [];
    }
  }

  async function listFilesRecursive(dir: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(d: string) {
      let entries: Dirent[] = [];
      try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(full);
      }
    }
    await walk(dir);
    return out;
  }

  // ===== Post-write hook: trigger prompts index & catalog export =====
  let reindexInFlight = false;
  async function triggerPromptsReindex(project: string): Promise<void> {
    if (reindexInFlight) return;
    reindexInFlight = true;
    try {
      const env = { ...process.env, MCP_PROMPTS_DIR: PROMPTS_DIR, CURRENT_PROJECT: project } as NodeJS.ProcessEnv;
      const scriptPath = path.join(REPO_ROOT, 'scripts', 'prompts.mjs');
      const run = (args: string[]) => new Promise<void>((resolve) => {
        const p = spawn('node', [scriptPath, ...args], {
          cwd: REPO_ROOT,
          env,
          stdio: 'ignore',
        });
        p.on('error', () => resolve());
        p.on('close', () => resolve());
      });
      // Full cycle to keep all artifacts consistent with main CI
      await run(['index']);
      await run(['catalog']);
      try { await run(['catalog:services']); } catch {}
      try { await run(['export-json']); } catch {}
      try { await run(['export-md']); } catch {}
      try { await run(['build']); } catch {}
    } catch {}
    finally {
      reindexInFlight = false;
    }
  }

  // Service Catalog tools (conditionally registered)
  if (isCatalogEnabled() && isCatalogReadEnabled()) {
    server.registerTool(
      "service_catalog_query",
      {
        title: "Service Catalog Query",
        description: "Query services from the service-catalog (supports filters, sort, pagination)",
        inputSchema: {
          search: z.string().optional(),
          component: z.string().optional(),
          owner: z.union([z.string(), z.array(z.string())]).optional(),
          tag: z.union([z.string(), z.array(z.string())]).optional(),
          domain: z.string().optional(),
          status: z.string().optional(),
          updatedFrom: z.string().optional(),
          updatedTo: z.string().optional(),
          sort: z.string().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
        },
      },
      async (params: any) => {
        try {
          const page = await catalogProvider.queryServices(params as any);
          return ok(page);
        } catch (e: any) {
          return err(`service-catalog query failed: ${e?.message || String(e)}`);
        }
      }
    );

  } else {
    console.warn('[startup][catalog] catalog read disabled — query tool will not be registered');
  }

  // ===== Resources Registration =====
  
  // Register task resources: task://{project}/{id}
  server.registerResource(
    "tasks",
    "task://tasks",
    {
      title: "Task Resources",
      description: "Access individual tasks by project and ID",
      mimeType: "application/json"
    },
    async (uri) => {
      // Handle list resources case - return all available tasks
      if (uri.href === "task://tasks") {
        const projectsData = await listProjects(getCurrentProject);
        const allTasks: any[] = [];
        
        for (const project of projectsData.projects.map((p: any) => p.id)) {
          try {
            const tasks = await listTasks({ project, includeArchived: false });
            for (const task of tasks) {
              allTasks.push({
                ...task,
                uri: `task://${project}/${task.id}`,
                name: `Task: ${task.title}`,
                description: `Project: ${project}, Status: ${task.status}, Priority: ${task.priority}`,
                project
              });
            }
          } catch {}
        }
        
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(allTasks, null, 2),
              mimeType: "application/json"
            }
          ]
        };
      }
      
      // Handle task status transitions via resource actions
      // task://{project}/{id}/{action}
      // action in: start | complete | close | trash | restore | archive
      const actionM = uri.href.match(/^task:\/\/([^\/]+)\/([^\/]+)\/(start|complete|close|trash|restore|archive)$/);
      if (actionM) {
        const project = actionM[1];
        const id = actionM[2];
        const action = actionM[3] as 'start'|'complete'|'close'|'trash'|'restore'|'archive';
        try {
          let payload: any = null;
          if (action === 'start') payload = await updateTask(project, id, { status: 'in_progress' } as any);
          else if (action === 'complete') payload = await updateTask(project, id, { status: 'completed' } as any);
          else if (action === 'close') payload = await closeTask(project, id);
          else if (action === 'trash') payload = await trashTask(project, id);
          else if (action === 'restore') payload = await restoreTask(project, id);
          else if (action === 'archive') payload = await archiveTask(project, id);
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify({ ok: true, project, id, action, data: payload ?? null }, null, 2),
                mimeType: 'application/json',
              },
            ],
          };
        } catch (e: any) {
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify({ ok: false, error: e?.message || String(e), project, id, action }, null, 2),
                mimeType: 'application/json',
              },
            ],
          };
        }
      }

      // Handle specific task resource: task://{project}/{id}
      const match = uri.href.match(/^task:\/\/([^\/]+)\/(.+)$/);
      if (!match) throw new Error("Invalid task URI format. Expected: task://{project}/{id}");
      
      const [, project, id] = match;
      const task = await getTask(project, id);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(task, null, 2),
            mimeType: "application/json"
          }
        ]
      };
    }
  );

  // Register knowledge resources: knowledge://{project}/{id}
  server.registerResource(
    "knowledge",
    "knowledge://docs",
    {
      title: "Knowledge Resources",
      description: "Access individual knowledge documents by project and ID",
      mimeType: "application/json"
    },
    async (uri) => {
      // Handle list resources case - return all available knowledge docs
      if (uri.href === "knowledge://docs") {
        const projectsData = await listProjects(getCurrentProject);
        const allDocs: any[] = [];
        
        for (const project of projectsData.projects.map((p: any) => p.id)) {
          try {
            const docs = await listDocs({ project, includeArchived: false });
            for (const doc of docs) {
              allDocs.push({
                ...doc,
                uri: `knowledge://${project}/${doc.id}`,
                name: `Knowledge: ${doc.title}`,
                description: `Project: ${project}, Type: ${doc.type || 'document'}, Tags: ${(doc.tags || []).join(', ')}`,
                project
              });
            }
          } catch {}
        }
        
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(allDocs, null, 2),
              mimeType: "application/json"
            }
          ]
        };
      }
      
      // Handle specific knowledge document: knowledge://{project}/{id}
      const match = uri.href.match(/^knowledge:\/\/([^\/]+)\/(.+)$/);
      if (!match) throw new Error("Invalid knowledge URI format. Expected: knowledge://{project}/{id}");
      
      const [, project, id] = match;
      const doc = await readDoc(project, id);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(doc, null, 2),
            mimeType: "application/json"
          }
        ]
      };
    }
  );

  // Register prompt resources: prompt://{project}/{id}@{version}  
  server.registerResource(
    "prompts",
    "prompt://catalog",
    {
      title: "Prompt Resources",
      description: "Access individual prompts by project, ID and version",
      mimeType: "application/json"
    },
    async (uri) => {
      // Handle list resources case - return all available prompts
      if (uri.href === "prompt://catalog") {
        const projectsData = await listProjects(getCurrentProject);
        const allPrompts: any[] = [];
        
        for (const project of projectsData.projects.map((p: any) => p.id)) {
          try {
            const catalog = await readPromptsCatalog(project);
            for (const [key, meta] of Object.entries<any>(catalog?.items || {})) {
              const version = meta.version || meta.buildVersion || 'latest';
              allPrompts.push({
                ...meta,
                uri: `prompt://${project}/${key}@${version}`,
                name: `Prompt: ${meta.title || key}`,
                description: `Project: ${project}, Kind: ${meta.kind || 'prompt'}, Domain: ${meta.domain}, Status: ${meta.status}`,
                project,
                key,
                version
              });
            }
          } catch {}
        }
        
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(allPrompts, null, 2),
              mimeType: "application/json"
            }
          ]
        };
      }
      
      // Handle specific prompt: prompt://{project}/{id}@{version}
      const match = uri.href.match(/^prompt:\/\/([^\/]+)\/([^@]+)@(.+)$/);
      if (!match) throw new Error("Invalid prompt URI format. Expected: prompt://{project}/{id}@{version}");
      
      const [, project, id, version] = match;
      const filePath = await findFileByIdVersion(project, id, version);
      if (!filePath) throw new Error(`Prompt not found: ${id}@${version} in project ${project}`);
      
      const content = await fs.readFile(filePath, 'utf8');
      const prompt = JSON.parse(content);
      
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(prompt, null, 2),
            mimeType: "application/json"
          }
        ]
      };
    }
  );

  // Register export resources: export://{project}/{type}/{filename}
  server.registerResource(
    "exports",
    "export://files",
    {
      title: "Export Resources",
      description: "Access exported prompt artifacts and files",
      mimeType: "application/json"
    },
    async (uri) => {
      // Handle list resources case - return all available exports
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
                  
                  allExports.push({
                    uri: `export://${project}/${type}/${relativePath}`,
                    name: `Export: ${fileName}`,
                    description: `Project: ${project}, Type: ${type}, Path: ${relativePath}`,
                    project,
                    type,
                    filename: relativePath,
                    mimeType
                  });
                }
              } catch {}
            }
          } catch {}
        }
        
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(allExports, null, 2),
              mimeType: "application/json"
            }
          ]
        };
      }
      
      // Handle specific export file: export://{project}/{type}/{filename}
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
        
        return {
          contents: [
            {
              uri: uri.href,
              text: content,
              mimeType
            }
          ]
        };
      } catch (error: any) {
        throw new Error(`Failed to read export file: ${error.message}`);
      }
    }
  );

  // ===== Tools as Resources =====

  // Catalog: tool://catalog — list all tools with metadata
  if (TOOL_RES_ENABLED) server.registerResource(
    "tools_catalog",
    "tool://catalog",
    {
      title: "Tools Catalog",
      description: "List registered tools and their metadata",
      mimeType: "application/json",
    },
    async (uri) => {
      const items = Array.from(toolRegistry.entries()).map(([name, meta]) => ({
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
      }));
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ total: items.length, items }, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );

  // Schema: tool://schema and tool://schema/{name}
  if (TOOL_RES_ENABLED) server.registerResource(
    "tools_schema",
    "tool://schema",
    {
      title: "Tool Schema",
      description: "Return metadata for a given tool name",
      mimeType: "application/json",
    },
    async (uri) => {
      const href = uri.href;
      const m = href.match(/^tool:\/\/schema\/?([^\/?#]+)?/);
      const name = m && m[1] ? decodeURIComponent(m[1]) : undefined;
      if (!name) {
        const items = Array.from(toolRegistry.keys());
        return {
          contents: [
            {
              uri: href,
              text: JSON.stringify({ error: 'name required', available: items }, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
      const meta = toolRegistry.get(name);
      if (!meta) {
        return {
          contents: [
            {
              uri: href,
              text: JSON.stringify({ error: `Tool not found: ${name}` }, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
      const payload = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
      };
      return {
        contents: [
          {
            uri: href,
            text: JSON.stringify(payload, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );
  // Note: tool://run resource removed — use tools_run tool (RPC) instead.

  // ===== Prompt Library: Catalog & Search =====
  server.registerTool(
    "prompts_catalog_get",
    {
      title: "Prompts Catalog Get",
      description: "Return prompts catalog JSON if present",
      inputSchema: { project: z.string().optional() },
    },
    async ({ project }: { project?: string }) => {
      const prj = resolveProject(project);
      const data = await readPromptsCatalog(prj);
      return data ? ok(data) : err('catalog not found');
    }
  );

  // graph_export_mermaid
  server.registerTool(
    "graph_export_mermaid",
    {
      title: "Export Graph (Mermaid)",
      description: "Build a Mermaid graph from tasks and knowledge (nodes + parent edges)",
      inputSchema: {
        project: z.string().optional(),
        includeArchived: z.boolean().optional(),
      },
    },
    async ({ project, includeArchived }: { project?: string; includeArchived?: boolean }) => {
      const prj = resolveProject(project);
      const tasks = await listTasks({ project: prj, includeArchived: !!includeArchived });
      const kMetas = await listDocs({ project: prj, includeArchived: !!includeArchived });

      const esc = (s: string) => (s || '').replace(/"/g, '\\"');
      const label = (title?: string) => esc((title || '').trim() || 'untitled');

      const lines: string[] = [];
      lines.push('graph TD');

      // Task nodes
      for (const t of tasks) {
        const nodeId = `T_${t.id}`;
        lines.push(`${nodeId}["task: ${label(t.title)}"]`);
      }
      // Knowledge nodes
      for (const m of kMetas) {
        const nodeId = `K_${m.id}`;
        lines.push(`${nodeId}["doc: ${label(m.title)}"]`);
      }

      // Task parent edges (child -> parent)
      for (const t of tasks) {
        if (t.parentId && tasks.find((x) => x.id === t.parentId)) {
          lines.push(`T_${t.id} --> T_${t.parentId}`);
        }
      }
      // Knowledge parent edges
      for (const m of kMetas) {
        if ((m as any).parentId && kMetas.find((x) => x.id === (m as any).parentId)) {
          lines.push(`K_${m.id} --> K_${(m as any).parentId}`);
        }
      }

      const mermaid = lines.join('\n');
      return ok({ project: prj, mermaid });
    }
  );

  // ===== Prompt Library: Bulk Create/Update/Delete =====
  // Helpers: determine dir by kind and find prompt files
  async function ensureDir(dir: string): Promise<void> {
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
  }
  function dirForKind(project: string, kind?: string): string {
    const base = path.join(PROMPTS_DIR, project);
    const k = (kind || 'prompt').toLowerCase();
    if (k === 'rule' || k === 'rules') return path.join(base, 'rules');
    if (k === 'workflow' || k === 'workflows') return path.join(base, 'workflows');
    if (k === 'template' || k === 'templates') return path.join(base, 'templates');
    if (k === 'policy' || k === 'policies') return path.join(base, 'policies');
    return path.join(base, 'prompts');
  }
  function validatePromptMinimal(obj: any): string[] {
    const errs: string[] = [];
    if (!obj || typeof obj !== 'object') return ['not an object'];
    if (obj.type !== 'prompt') errs.push('type must be "prompt"');
    if (!obj.id || typeof obj.id !== 'string') errs.push('id required string');
    if (!obj.version || typeof obj.version !== 'string') errs.push('version required string');
    const meta = obj.metadata;
    if (!meta || typeof meta !== 'object') errs.push('metadata required object');
    else {
      if (!meta.title) errs.push('metadata.title required');
      if (!meta.domain) errs.push('metadata.domain required');
      if (!meta.status) errs.push('metadata.status required');
    }
    const kind = meta?.kind || 'prompt';
    if (kind === 'workflow') {
      if (!Array.isArray(obj.compose)) errs.push('compose array required for workflow');
    } else {
      if (!obj.template || typeof obj.template !== 'string') errs.push('template required string');
    }
    if (!Array.isArray(obj.variables)) errs.push('variables must be array');
    return errs;
  }
  async function listSourceJsonFiles(project: string): Promise<string[]> {
    const base = path.join(PROMPTS_DIR, project);
    const dirs = ['prompts', 'rules', 'workflows', 'templates', 'policies'].map((d) => path.join(base, d));
    const out: string[] = [];
    for (const d of dirs) {
      let entries: Dirent[] = [];
      try { entries = await (await import('node:fs')).promises.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith('.json')) continue;
        out.push(path.join(d, e.name));
      }
    }
    return out;
  }
  async function findFileByIdVersion(project: string, id: string, version: string): Promise<string | null> {
    const files = await listSourceJsonFiles(project);
    for (const f of files) {
      try {
        const raw = await fs.readFile(f, 'utf8');
        const j = JSON.parse(raw);
        if (j && j.id === id && j.version === version) return f;
      } catch {}
    }
    return null;
  }

  // prompts_bulk_create — create many prompt files
  server.registerTool(
    "prompts_bulk_create",
    {
      title: "Prompts Bulk Create",
      description: "Create many prompts (writes JSON files under prompts/|rules/|workflows/|templates/|policies)",
      inputSchema: {
        project: z.string().optional(),
        items: z.array(z.record(z.any())).min(1).max(100),
        overwrite: z.boolean().optional(),
      },
    },
    async ({ project, items, overwrite }: { project?: string; items: any[]; overwrite?: boolean }) => {
      const prj = resolveProject(project);
      const results: Array<{ id: string; version: string; path?: string; error?: string }> = [];
      for (const obj of items) {
        try {
          const errs = validatePromptMinimal(obj);
          if (errs.length) {
            results.push({ id: obj?.id || '', version: obj?.version || '', error: `validation failed: ${errs.join('; ')}` });
            continue;
          }
          const kind = obj?.metadata?.kind || 'prompt';
          const dir = dirForKind(prj, kind);
          await ensureDir(dir);
          const file = path.join(dir, `${obj.id}@${obj.version}.json`);
          const exists = await fs.access(file).then(() => true).catch(() => false);
          if (exists && !overwrite) {
            results.push({ id: obj.id, version: obj.version, error: 'file exists (set overwrite=true to replace)' });
            continue;
          }
          await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
          results.push({ id: obj.id, version: obj.version, path: file });
        } catch (e: any) {
          results.push({ id: obj?.id || '', version: obj?.version || '', error: e?.message || String(e) });
        }
      }
      const allOk = results.every((r) => !r.error);
      // Fire-and-forget reindex on successful writes (at least one write succeeded)
      try {
        if (results.some((r) => r.path && !r.error)) {
          void triggerPromptsReindex(prj);
        }
      } catch {}
      return allOk ? ok({ project: prj, results }) : err('some items failed; see results');
    }
  );

  // prompts_bulk_update — update many prompt files by id+version or by explicit path
  server.registerTool(
    "prompts_bulk_update",
    {
      title: "Prompts Bulk Update",
      description: "Update many prompts found by id+version or explicit path",
      inputSchema: {
        project: z.string().optional(),
        items: z.array(z.object({
          selector: z.object({ id: z.string().optional(), version: z.string().optional(), path: z.string().optional() }),
          patch: z.record(z.any()),
        })).min(1).max(100),
      },
    },
    async ({ project, items }: { project?: string; items: Array<{ selector: { id?: string; version?: string; path?: string }, patch: any }> }) => {
      const prj = resolveProject(project);
      const results: Array<{ id?: string; version?: string; path?: string; error?: string }> = [];
      for (const it of items) {
        try {
          let targetPath = it.selector.path || null;
          let baseId = it.selector.id;
          let baseVer = it.selector.version;
          if (!targetPath) {
            if (!baseId || !baseVer) throw new Error('selector requires either path or id+version');
            targetPath = await findFileByIdVersion(prj, baseId, baseVer);
            if (!targetPath) throw new Error(`file not found for ${baseId}@${baseVer}`);
          }
          const raw = await fs.readFile(targetPath, 'utf8');
          const current = JSON.parse(raw);
          const updated = { ...current, ...it.patch };
          // If id/version changed in patch, adjust filename and destination dir
          const errs = validatePromptMinimal(updated);
          if (errs.length) throw new Error(`validation failed: ${errs.join('; ')}`);
          const kind = updated?.metadata?.kind || 'prompt';
          const dstDir = dirForKind(prj, kind);
          await ensureDir(dstDir);
          const dstFile = path.join(dstDir, `${updated.id}@${updated.version}.json`);
          await fs.writeFile(dstFile, JSON.stringify(updated, null, 2) + '\n', 'utf8');
          if (dstFile !== targetPath) {
            // Best-effort: remove old file if different
            try { await fs.unlink(targetPath); } catch {}
          }
          results.push({ id: updated.id, version: updated.version, path: dstFile });
        } catch (e: any) {
          results.push({ id: it.selector.id, version: it.selector.version, path: it.selector.path, error: e?.message || String(e) });
        }
      }
      const allOk = results.every((r) => !r.error);
      // Fire-and-forget reindex on successful writes (at least one write succeeded)
      try {
        if (results.some((r) => r.path && !r.error)) {
          void triggerPromptsReindex(prj);
        }
      } catch {}
      return allOk ? ok({ project: prj, results }) : err('some items failed; see results');
    }
  );

  // prompts_bulk_delete — delete prompts by id+version or by explicit path
  server.registerTool(
    "prompts_bulk_delete",
    {
      title: "Prompts Bulk Delete",
      description: "Delete many prompts by id+version or by explicit path",
      inputSchema: {
        project: z.string().optional(),
        items: z.array(z.object({ id: z.string().optional(), version: z.string().optional(), path: z.string().optional() })).min(1).max(200),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, items, dryRun }: { project?: string; items: Array<{ id?: string; version?: string; path?: string }>; dryRun?: boolean }) => {
      const prj = resolveProject(project);
      const results: Array<{ id?: string; version?: string; path?: string; deleted?: boolean; error?: string }> = [];
      for (const sel of items) {
        try {
          let targetPath = sel.path || null;
          if (!targetPath) {
            if (!sel.id || !sel.version) throw new Error('selector requires either path or id+version');
            targetPath = await findFileByIdVersion(prj, sel.id, sel.version);
            if (!targetPath) throw new Error(`file not found for ${sel.id}@${sel.version}`);
          }
          if (!dryRun) {
            await fs.unlink(targetPath);
          }
          results.push({ id: sel.id, version: sel.version, path: targetPath, deleted: dryRun ? false : true });
        } catch (e: any) {
          results.push({ id: sel.id, version: sel.version, path: sel.path, error: e?.message || String(e) });
        }
      }
      const allOk = results.every((r) => !r.error);
      try {
        if (!dryRun && results.some((r) => r.deleted && !r.error)) {
          void triggerPromptsReindex(prj);
        }
      } catch {}
      return allOk ? ok({ project: prj, results, dryRun: !!dryRun }) : err('some items failed; see results');
    }
  );

  // ===== Prompt Library: Feedback & Reports & Listing =====
  // prompts_feedback_log — append passive feedback events to JSONL
  server.registerTool(
    "prompts_feedback_log",
    {
      title: "Prompts Feedback Log",
      description: "Append passive user feedback for prompts (JSONL store)",
      inputSchema: {
        project: z.string().optional(),
        promptId: z.string().min(1),
        version: z.string().min(1),
        variant: z.string().nullable().optional(),
        sessionId: z.string().optional(),
        userId: z.string().optional(),
        inputText: z.string().optional(),
        modelOutput: z.string().optional(),
        userMessage: z.string().optional(),
        userEdits: z.string().optional(),
        signals: z
          .object({
            thumb: z.enum(["up", "down"]).optional(),
            copied: z.boolean().optional(),
            abandoned: z.boolean().optional(),
          })
          .optional(),
        meta: z.record(z.any()).optional(),
      },
    },
    async (params: any) => {
      const prj = resolveProject(params?.project);
      const file = path.join(PROMPTS_DIR, prj, 'experiments', 'feedback.jsonl');
      const ts = new Date().toISOString();
      const event = {
        ts,
        project: prj,
        promptId: params.promptId,
        version: params.version,
        variant: params.variant ?? null,
        sessionId: params.sessionId,
        userId: params.userId,
        inputText: params.inputText,
        modelOutput: params.modelOutput,
        userMessage: params.userMessage,
        userEdits: params.userEdits,
        signals: params.signals || {},
        meta: params.meta || {},
      };
      const appended = await appendJsonl(file, [event]);
      return ok({ path: file, appended });
    }
  );

  // prompts_ab_report — aggregate A/B aggregates + passive feedback stats
  server.registerTool(
    "prompts_ab_report",
    {
      title: "Prompts A/B Report",
      description: "Aggregate A/B metrics and passive feedback for all prompt keys",
      inputSchema: {
        project: z.string().optional(),
        writeToDisk: z.boolean().optional(),
      },
    },
    async ({ project, writeToDisk }: { project?: string; writeToDisk?: boolean }) => {
      const prj = resolveProject(project);
      const catalog = await readPromptsCatalog(prj);
      const keys: string[] = Object.keys(catalog?.items || {});
      const byPrompt: Record<string, any> = {};
      for (const k of keys) {
        try {
          const aggr = await readAggregates(prj, k);
          // summarize aggregates
          const rows = Object.entries(aggr).map(([variantId, s]: any) => {
            const avgScore = s.trials > 0 ? s.scoreSum / s.trials : 0;
            const successRate = s.trials > 0 ? s.successes / s.trials : 0;
            const avgLatencyMs = s.trials > 0 ? s.latencySumMs / s.trials : 0;
            const avgCost = s.trials > 0 ? s.costSum / s.trials : 0;
            const avgTokensIn = s.trials > 0 ? s.tokensInSum / s.trials : 0;
            const avgTokensOut = s.trials > 0 ? s.tokensOutSum / s.trials : 0;
            return { variantId, trials: s.trials, successRate, avgScore, avgLatencyMs, avgCost, avgTokensIn, avgTokensOut };
          });
          byPrompt[k] = { variants: rows };
        } catch {}
      }

      // Feedback stats
      const feedbackPath = path.join(PROMPTS_DIR, prj, 'experiments', 'feedback.jsonl');
      const feedback = await readJsonl(feedbackPath);
      let thumbsUp = 0, thumbsDown = 0, copied = 0, abandoned = 0, editChars = 0, editCount = 0;
      for (const e of feedback) {
        const sig = e?.signals || {};
        if (sig.thumb === 'up') thumbsUp++;
        else if (sig.thumb === 'down') thumbsDown++;
        if (sig.copied) copied++;
        if (sig.abandoned) abandoned++;
        if (typeof e?.userEdits === 'string' && e.userEdits.length > 0) {
          editChars += e.userEdits.length;
          editCount += 1;
        }
      }
      const totalThumbs = thumbsUp + thumbsDown;
      const outReport = {
        generatedAt: new Date().toISOString(),
        project: prj,
        totalExperiments: keys.length,
        totalFeedbackEvents: feedback.length,
        byPrompt,
        feedback: {
          thumbs: { up: thumbsUp, down: thumbsDown, acceptance: totalThumbs > 0 ? thumbsUp / totalThumbs : 0 },
          copiedRate: feedback.length > 0 ? copied / feedback.length : 0,
          abandonedRate: feedback.length > 0 ? abandoned / feedback.length : 0,
          avgEditChars: editCount > 0 ? editChars / editCount : 0,
          editRate: feedback.length > 0 ? editCount / feedback.length : 0,
        },
      };

      let pathOut: string | undefined;
      if (writeToDisk) {
        const outDir = path.join(PROMPTS_DIR, prj, 'reports');
        await fs.mkdir(outDir, { recursive: true });
        pathOut = path.join(outDir, `ab_report_${Date.now()}.json`);
        await fs.writeFile(pathOut, JSON.stringify(outReport, null, 2), 'utf8');
      }

      return ok({ ...outReport, path: pathOut });
    }
  );

  // prompts_list — list prompts with simple filters based on catalog
  server.registerTool(
    "prompts_list",
    {
      title: "Prompts List",
      description: "List prompts from prompts catalog with optional filters",
      inputSchema: {
        project: z.string().optional(),
        latest: z.boolean().optional(),
        kind: z.string().optional(),
        status: z.string().optional(),
        domain: z.string().optional(),
        tag: z.array(z.string()).optional(),
      },
    },
    async ({ project, latest, kind, status, domain, tag }: { project?: string; latest?: boolean; kind?: string; status?: string; domain?: string; tag?: string[] }) => {
      const prj = resolveProject(project);
      const catalog = await readPromptsCatalog(prj);
      const items: any[] = [];
      const tagSet = tag && tag.length ? new Set(tag) : undefined;
      for (const [key, meta] of Object.entries<any>(catalog?.items || {})) {
        const rec = {
          id: key,
          version: meta.version || meta.buildVersion || 'latest',
          kind: meta.kind || meta.type || 'prompt',
          status: meta.status || undefined,
          domain: meta.domain || undefined,
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          file: meta.path || undefined,
        };
        if (kind && rec.kind !== kind) continue;
        if (status && rec.status !== status) continue;
        if (domain && rec.domain !== domain) continue;
        if (tagSet && !(rec.tags || []).some((t: string) => tagSet.has(t))) continue;
        items.push(rec);
      }
      // latest flag is kept for parity; catalog is assumed latest already
      return ok({ generatedAt: new Date().toISOString(), total: items.length, items });
    }
  );

  // prompts_feedback_validate — quick JSONL validation
  server.registerTool(
    "prompts_feedback_validate",
    {
      title: "Prompts Feedback Validate",
      description: "Validate feedback JSONL file and return stats/samples",
      inputSchema: { project: z.string().optional(), strict: z.boolean().optional() },
    },
    async ({ project, strict }: { project?: string; strict?: boolean }) => {
      const prj = resolveProject(project);
      const file = path.join(PROMPTS_DIR, prj, 'experiments', 'feedback.jsonl');
      const content = await fs.readFile(file, 'utf8').catch(() => '');
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const samples: Array<{ line: number; error?: string }> = [];
      let valid = 0, invalid = 0;
      lines.forEach((l, i) => {
        try {
          const obj = JSON.parse(l);
          const ok = typeof obj?.promptId === 'string' && typeof obj?.version === 'string';
          if (ok) valid++; else { invalid++; samples.push({ line: i + 1, error: 'missing promptId/version' }); }
        } catch (e: any) {
          invalid++; samples.push({ line: i + 1, error: e?.message || 'parse error' });
        }
      });
      if (strict) {
        // In strict mode, truncate samples to first 20 to keep payload small
        samples.splice(20);
      }
      return ok({ path: file, total: lines.length, valid, invalid, samples });
    }
  );

  // prompts_exports_get — list exported prompt artifacts
  server.registerTool(
    "prompts_exports_get",
    {
      title: "Prompts Exports Get",
      description: "List exported prompt artifacts under exports/",
      inputSchema: { project: z.string().optional(), type: z.enum(["json","markdown","builds","catalog","all"]).optional() },
    },
    async ({ project, type }: { project?: string; type?: 'json'|'markdown'|'builds'|'catalog'|'all' }) => {
      const prj = resolveProject(project);
      const base = path.join(PROMPTS_DIR, prj, 'exports');
      const wanted = type || 'all';
      const dirs: string[] = [];
      if (wanted === 'all' || wanted === 'builds') dirs.push(path.join(base, 'builds'));
      if (wanted === 'all' || wanted === 'catalog') dirs.push(path.join(base, 'catalog'));
      if (wanted === 'all' || wanted === 'json') dirs.push(path.join(base, 'json'));
      if (wanted === 'all' || wanted === 'markdown') dirs.push(path.join(base, 'markdown'));
      const files: Array<{ path: string; size: number }> = [];
      for (const d of dirs) {
        const list = await listFilesRecursive(d).catch(() => []);
        for (const f of list) {
          try {
            const st = await (await import('node:fs')).promises.stat(f);
            files.push({ path: f, size: st.size });
          } catch {}
        }
      }
      return ok({ baseDir: base, files });
    }
  );

  // prompts_build — build workflow prompts into exports/builds as MD and JSON artifacts
  if (isPromptsBuildEnabled()) {
    server.registerTool(
      "prompts_build",
      {
        title: "Prompts Build",
        description: "Build workflow prompts composed from referenced rules/templates/policies into Markdown and JSON artifacts",
        inputSchema: {
          project: z.string().optional(),
          ids: z.array(z.string()).optional(),
          includeKinds: z.array(z.string()).optional(),
          excludeKinds: z.array(z.string()).optional(),
          includeTags: z.array(z.string()).optional(),
          excludeTags: z.array(z.string()).optional(),
          latest: z.boolean().optional(),
          dryRun: z.boolean().optional(),
          force: z.boolean().optional(),
          separator: z.string().optional(),
        },
      },
      async ({ project, ids, includeKinds, excludeKinds, includeTags, excludeTags, latest, dryRun, force, separator }: {
        project?: string;
        ids?: string[];
        includeKinds?: string[];
        excludeKinds?: string[];
        includeTags?: string[];
        excludeTags?: string[];
        latest?: boolean;
        dryRun?: boolean;
        force?: boolean;
        separator?: string;
      }) => {
        const prj = resolveProject(project);
        try {
          const res = await buildWorkflows(prj, { ids, includeKinds, excludeKinds, includeTags, excludeTags, latest, dryRun, force, separator });
          return ok({ project: prj, ...res });
        } catch (e: any) {
          return err(String(e?.message || e));
        }
      }
    );

  }

  server.registerTool(
    "prompts_search",
    {
      title: "Prompts Search (hybrid)",
      description: "Semantic/lexical search across prompt builds and markdown",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        tags: z.array(z.string()).optional(),
        kinds: z.array(z.string()).optional(),
      },
    },
    async ({ project, query, limit, tags, kinds }: { project?: string; query: string; limit?: number; tags?: string[]; kinds?: string[] }) => {
      const prj = resolveProject(project);
      const catalog = await readPromptsCatalog(prj);
      const items = await readPromptBuildItems(prj);
      const tagSet = tags && tags.length ? new Set(tags) : undefined;
      const kindSet = kinds && kinds.length ? new Set(kinds) : undefined;
      const filtered = items.filter((it) => {
        const meta = catalog?.items?.[it.item.key] || {};
        const allTags: string[] = Array.from(new Set([...(it.item.tags || []), ...(meta.tags || [])]));
        const kind = it.item.kind || meta.kind || meta.type || 'prompt';
        if (tagSet && !allTags.some((t) => tagSet.has(t))) return false;
        if (kindSet && !kindSet.has(kind)) return false;
        return true;
      });
      const va = await ensureVectorAdapter();
      const results = await hybridSearch(query, filtered, { limit: limit ?? 20, vectorAdapter: va });
      const mapped = results.map((r) => {
        const meta = catalog?.items?.[r.item.key] || {};
        const kind = r.item.kind || meta.kind || meta.type || 'prompt';
        const title = r.item.title || meta.title || r.item.key;
        const tagsOut: string[] = Array.from(new Set([...(r.item.tags || []), ...(meta.tags || [])]));
        return { key: r.item.key, kind, title, score: r.score, tags: tagsOut, path: r.item.path };
      });
      return ok(mapped);
    }
  );

  // ===== Prompt Library: Variants & Metrics =====
  server.registerTool(
    "prompts_variants_list",
    {
      title: "Prompts Variants List",
      description: "List available variants for a promptKey (experiment or builds)",
      inputSchema: { project: z.string().optional(), promptKey: z.string().min(1) },
    },
    async ({ project, promptKey }: { project?: string; promptKey: string }) => {
      const exp = await readExperiment(project, promptKey);
      const fromExp = exp?.variants || [];
      const fromBuilds = await listBuildVariants(project, promptKey);
      const variants = Array.from(new Set([...(fromExp || []), ...fromBuilds]));
      return ok({ promptKey, variants });
    }
  );

  server.registerTool(
    "prompts_variants_stats",
    {
      title: "Prompts Variants Stats",
      description: "Return aggregate metrics per variant for given promptKey",
      inputSchema: { project: z.string().optional(), promptKey: z.string().min(1) },
    },
    async ({ project, promptKey }: { project?: string; promptKey: string }) => {
      const aggr = await readAggregates(project, promptKey);
      const rows = Object.entries(aggr).map(([variantId, s]) => {
        const avgScore = s.trials > 0 ? s.scoreSum / s.trials : 0;
        const successRate = s.trials > 0 ? s.successes / s.trials : 0;
        const avgLatencyMs = s.trials > 0 ? s.latencySumMs / s.trials : 0;
        const avgCost = s.trials > 0 ? s.costSum / s.trials : 0;
        const avgTokensIn = s.trials > 0 ? s.tokensInSum / s.trials : 0;
        const avgTokensOut = s.trials > 0 ? s.tokensOutSum / s.trials : 0;
        return { variantId, trials: s.trials, successRate, avgScore, avgLatencyMs, avgCost, avgTokensIn, avgTokensOut };
      });
      return ok({ promptKey, stats: rows });
    }
  );

  server.registerTool(
    "prompts_bandit_next",
    {
      title: "Prompts Bandit Next",
      description: "Pick next variant for a prompt using epsilon-greedy over aggregates",
      inputSchema: {
        project: z.string().optional(),
        promptKey: z.string().min(1),
        epsilon: z.number().min(0).max(1).optional(),
        contextTags: z.array(z.string()).optional(),
      },
    },
    async ({ project, promptKey, epsilon, contextTags }: { project?: string; promptKey: string; epsilon?: number; contextTags?: string[] }) => {
      const exp = await readExperiment(project, promptKey);
      let variants = Array.from(new Set([...(exp?.variants || []), ...(await listBuildVariants(project, promptKey))]));
      if (variants.length === 0) variants = [promptKey];
      const stats = await readAggregates(project, promptKey);
      const variantId = pickWithEpsilonGreedy(variants, stats, { epsilon });
      const assignmentId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const assignment = { id: assignmentId, ts: new Date().toISOString(), promptKey, variantId, strategy: `epsilon_greedy(${epsilon ?? 0.1})`, contextTags };
      await appendAssignments(project, [assignment]);
      return ok(assignment);
    }
  );

  server.registerTool(
    "prompts_metrics_log_bulk",
    {
      title: "Prompts Metrics Log (Bulk)",
      description: "Append events and update aggregates for prompts (bulk)",
      inputSchema: {
        project: z.string().optional(),
        promptKey: z.string().min(1),
        items: z
          .array(
            z.object({
              ts: z.string().optional(),
              requestId: z.string().min(1),
              userId: z.string().optional(),
              model: z.string().optional(),
              variantId: z.string().min(1),
              outcome: z.object({
                success: z.boolean().optional(),
                score: z.number().optional(),
                tokensIn: z.number().optional(),
                tokensOut: z.number().optional(),
                latencyMs: z.number().optional(),
                cost: z.number().optional(),
                error: z.string().optional(),
              }),
              contextTags: z.array(z.string()).optional(),
            })
          )
          .min(1)
          .max(200),
      },
    },
    async ({ project, promptKey, items }: { project?: string; promptKey: string; items: any[] }) => {
      const tsNow = new Date().toISOString();
      const enriched = items.map((e) => ({ ts: e.ts || tsNow, ...e, promptKey }));
      await appendEvents(project, promptKey, enriched);
      const aggr = await updateAggregates(project, promptKey, enriched);
      return ok({ count: enriched.length, aggregates: aggr });
    }
  );

  // prompts_experiments_upsert — create or update experiment manifest with variants
  server.registerTool(
    "prompts_experiments_upsert",
    {
      title: "Prompts Experiments Upsert",
      description: "Create or update experiment manifest with variants to drive variants_list and bandit",
      inputSchema: {
        project: z.string().optional(),
        promptKey: z.string().min(1),
        variants: z.array(z.string().min(1)).min(1),
        params: z.record(z.any()).optional(),
      },
    },
    async ({ project, promptKey, variants, params }: { project?: string; promptKey: string; variants: string[]; params?: any }) => {
      const prj = resolveProject(project);
      const file = path.join(PROMPTS_DIR, prj, 'metrics', 'experiments', `${promptKey}.json`);
      const payload = { variants: Array.from(new Set((variants || []).filter((v) => typeof v === 'string' && v.trim().length > 0))), params: params || {} };
      if (payload.variants.length === 0) {
        return err('variants must contain at least one non-empty string');
      }
      try {
        await ensureDirForFile(file);
        await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
        return ok({ project: prj, promptKey, path: file, variants: payload.variants });
      } catch (e: any) {
        return err(e?.message || String(e));
      }
    }
  );

  // obsidian_export_project
  server.registerTool(
    "obsidian_export_project",
    {
      title: "Export Project to Obsidian Vault",
      description: "Export knowledge, tasks, and prompts to Obsidian vault (merge or replace). Use with caution in replace mode.",
      inputSchema: {
        project: z.string().optional(),
        knowledge: z.boolean().optional(),
        tasks: z.boolean().optional(),
        // Prompts (Prompt Library)
        prompts: z.boolean().optional(),
        includePromptSourcesJson: z.boolean().optional(),
        includePromptSourcesMd: z.boolean().optional(),
        strategy: z.enum(["merge", "replace"]).optional(),
        // Filters common
        includeArchived: z.boolean().optional(),
        updatedFrom: z.string().optional(),
        updatedTo: z.string().optional(),
        includeTags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
        // Knowledge-only
        includeTypes: z.array(z.string()).optional(),
        excludeTypes: z.array(z.string()).optional(),
        // Tasks-only
        includeStatus: z.array(z.enum(["pending", "in_progress", "completed", "closed"])).optional(),
        includePriority: z.array(z.enum(["low", "medium", "high"])).optional(),
        // Structure control
        keepOrphans: z.boolean().optional(),
        // UX helpers
        confirm: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, knowledge, tasks, prompts, includePromptSourcesJson, includePromptSourcesMd, strategy, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans, confirm, dryRun }: { project?: string; knowledge?: boolean; tasks?: boolean; prompts?: boolean; includePromptSourcesJson?: boolean; includePromptSourcesMd?: boolean; strategy?: 'merge' | 'replace'; includeArchived?: boolean; updatedFrom?: string; updatedTo?: string; includeTags?: string[]; excludeTags?: string[]; includeTypes?: string[]; excludeTypes?: string[]; includeStatus?: Array<'pending'|'in_progress'|'completed'|'closed'>; includePriority?: Array<'low'|'medium'|'high'>; keepOrphans?: boolean; confirm?: boolean; dryRun?: boolean }) => {
      const cfg = loadConfig();
      const prj = resolveProject(project);
      const doKnowledge = knowledge !== false;
      const doTasks = tasks !== false;
      const doPrompts = prompts !== false;
      const strat = strategy || 'merge';

      if (dryRun) {
        const plan = await planExportProjectToVault(prj, {
          knowledge: doKnowledge,
          tasks: doTasks,
          prompts: doPrompts,
          strategy: strat,
          includeArchived,
          updatedFrom,
          updatedTo,
          includeTags,
          excludeTags,
          includeTypes,
          excludeTypes,
          includeStatus,
          includePriority,
          keepOrphans,
        });
        return ok({
          project: prj,
          strategy: strat,
          knowledge: doKnowledge,
          tasks: doTasks,
          prompts: doPrompts,
          plan: {
            willWrite: { knowledgeCount: plan.knowledgeCount, tasksCount: plan.tasksCount, promptsCount: plan.promptsCount },
            willDeleteDirs: plan.willDeleteDirs,
          },
        });
      }

      if (strat === 'replace' && confirm !== true) {
        return err('Export replace not confirmed: pass confirm=true to proceed');
      }

      try {
        const result = await exportProjectToVault(prj, { knowledge: doKnowledge, tasks: doTasks, prompts: doPrompts, includePromptSourcesJson, includePromptSourcesMd, strategy: strat, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans });
        return ok(result);
      } catch (e: any) {
        return err(String(e?.message || e));
      }
    }
  );

  // obsidian_import_project
  server.registerTool(
    "obsidian_import_project",
    {
      title: "Import Project from Obsidian Vault",
      description: "Import knowledge, tasks, and prompts from Obsidian vault. Replace strategy deletes existing content — use with caution.",
      inputSchema: {
        project: z.string().optional(),
        knowledge: z.boolean().optional(),
        tasks: z.boolean().optional(),
        // Prompts (Prompt Library)
        prompts: z.boolean().optional(),
        importPromptSourcesJson: z.boolean().optional(),
        importPromptMarkdown: z.boolean().optional(),
        overwriteByTitle: z.boolean().optional(),
        strategy: z.enum(["merge", "replace"]).optional(),
        mergeStrategy: z.enum(["overwrite", "append", "skip", "fail"]).optional(),
        // Filters: path-based (glob, relative to project root in vault)
        includePaths: z.array(z.string()).optional(),
        excludePaths: z.array(z.string()).optional(),
        // Filters: common
        includeTags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
        // Filters: knowledge-only
        includeTypes: z.array(z.string()).optional(),
        // Filters: tasks-only
        includeStatus: z.array(z.enum(["pending", "in_progress", "completed", "closed"])).optional(),
        includePriority: z.array(z.enum(["low", "medium", "high"])).optional(),
        // UX helpers
        confirm: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, knowledge, tasks, prompts, importPromptSourcesJson, importPromptMarkdown, overwriteByTitle, strategy, mergeStrategy, includePaths, excludePaths, includeTags, excludeTags, includeTypes, includeStatus, includePriority, confirm, dryRun }: { project?: string; knowledge?: boolean; tasks?: boolean; prompts?: boolean; importPromptSourcesJson?: boolean; importPromptMarkdown?: boolean; overwriteByTitle?: boolean; strategy?: 'merge' | 'replace'; mergeStrategy?: 'overwrite' | 'append' | 'skip' | 'fail'; includePaths?: string[]; excludePaths?: string[]; includeTags?: string[]; excludeTags?: string[]; includeTypes?: string[]; includeStatus?: Array<'pending'|'in_progress'|'completed'|'closed'>; includePriority?: Array<'low'|'medium'|'high'>; confirm?: boolean; dryRun?: boolean }) => {
      // Ensure config is loaded (validates DATA_DIR/VAULT envs and logs diagnostics)
      const cfg = loadConfig();
      const prj = resolveProject(project);
      const doKnowledge = knowledge !== false;
      const doTasks = tasks !== false;
      const doPrompts = prompts !== false;
      const strat = strategy || 'merge';
      const mstrat = mergeStrategy || 'overwrite';

      const commonOpts = {
        knowledge: doKnowledge,
        tasks: doTasks,
        prompts: doPrompts,
        importPromptSourcesJson,
        importPromptMarkdown,
        overwriteByTitle,
        strategy: strat as 'merge' | 'replace',
        mergeStrategy: mstrat as 'overwrite' | 'append' | 'skip' | 'fail',
        includePaths,
        excludePaths,
        includeTags,
        excludeTags,
        includeTypes,
        includeStatus,
        includePriority,
      } as const;

      // Dry-run planning
      if (dryRun) {
        try {
          const plan = await planImportProjectFromVault(prj, commonOpts as any);
          return ok({
            project: prj,
            strategy: strat,
            mergeStrategy: mstrat,
            knowledge: doKnowledge,
            tasks: doTasks,
            prompts: doPrompts,
            plan,
          });
        } catch (e: any) {
          return err(String(e?.message || e));
        }
      }

      // Replace requires explicit confirmation
      if (strat === 'replace' && confirm !== true) {
        return err('Import replace not confirmed: pass confirm=true to proceed');
      }

      // Execute import
      try {
        const result = await importProjectFromVault(prj, commonOpts as any);
        return ok(result);
      } catch (e: any) {
        return err(String(e?.message || e));
      }
    }
  );

  // Helper function to chunk arrays
  const chunkArray = <T>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  };

  // project.list — перечислить проекты на диске по подкаталогам в tasks/ и knowledge/
  server.registerTool(
    "project_list",
    {
      title: "Project List",
      description: "List available projects by scanning disk under tasks/ and knowledge/",
      inputSchema: {},
    },
    async () => {
      const out = await listProjects(getCurrentProject);
      return ok(out);
    }
  );

  // embeddings.try_init — принудительно инициализировать векторный адаптер и вернуть диагностическую инфу
  server.registerTool(
    "embeddings_try_init",
    {
      title: "Embeddings Try Init",
      description: "Force lazy initialization of vector adapter and return diagnostics",
      inputSchema: {},
    },
    async () => {
      const startedAt = Date.now();
      const c = loadConfig();
      const result: any = { mode: c.embeddings.mode, startedAt };
      try {
        const va = await ensureVectorAdapter();
        result.elapsedMs = Date.now() - startedAt;
        result.initialized = Boolean(va);
        if (va && typeof va.info === 'function') {
          try { result.adapterInfo = await va.info(); } catch {}
        }
        if (!va) {
          result.message = 'vector adapter not available after init attempt';
        }
      } catch (e: any) {
        result.elapsedMs = Date.now() - startedAt;
        result.initialized = false;
        result.error = String(e?.message || e);
      }
      return ok(result);
    }
  );

  if (isCatalogEnabled() && isCatalogReadEnabled()) {
    server.registerTool(
      "service_catalog_health",
      {
        title: "Service Catalog Health",
        description: "Check health of the configured service-catalog source (remote/embedded)",
        inputSchema: {},
      },
      async () => {
        const h = await catalogProvider.health();
        return ok(h);
      }
    );
  }

  // Catalog write tools: upsert and delete
  if (isCatalogEnabled() && isCatalogWriteEnabled()) {
    // service_catalog_upsert
    server.registerTool(
      "service_catalog_upsert",
      {
        title: "Service Catalog Upsert Services",
        description: "Create or update services in the service catalog (embedded or hybrid-embedded)",
        inputSchema: {
          items: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                component: z.string().min(1),
                domain: z.string().optional(),
                status: z.string().optional(),
                owners: z.array(z.string()).optional(),
                tags: z.array(z.string()).optional(),
                annotations: z.record(z.string()).optional(),
                updatedAt: z.string().optional(),
              })
            )
            .min(1)
            .max(100),
        },
      },
      async ({ items }: { items: Array<{ id: string; name: string; component: string; domain?: string; status?: string; owners?: string[]; tags?: string[]; annotations?: Record<string, string>; updatedAt?: string }> }) => {
        try {
          const res = await catalogProvider.upsertServices(items as any);
          return ok(res);
        } catch (e: any) {
          return err(`service-catalog upsert failed: ${e?.message || String(e)}`);
        }
      }
    );

    // service_catalog_delete
    server.registerTool(
      "service_catalog_delete",
      {
        title: "Service Catalog Delete Services",
        description: "Delete services by ids from the service catalog (embedded or hybrid-embedded)",
        inputSchema: {
          ids: z.array(z.string().min(1)).min(1).max(200),
        },
      },
      async ({ ids }: { ids: string[] }) => {
        try {
          const res = await catalogProvider.deleteServices(ids);
          return ok(res);
        } catch (e: any) {
          return err(`service-catalog delete failed: ${e?.message || String(e)}`);
        }
      }
    );
  }

  // tasks.bulk_update
  server.registerTool(
    "tasks_bulk_update",
    {
      title: "Bulk Update Tasks",
      description: "Update fields of many tasks at once",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().optional(),
              description: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
              tags: z.array(z.string()).optional(),
              links: z.array(z.string()).optional(),
              parentId: z.string().nullable().optional(),
              status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const results: any[] = [];
      for (const it of items) {
        const { id, ...patch } = it as any;
        const t = await updateTask(prj, id, patch as any);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );

  // knowledge.bulk_update
  server.registerTool(
    "knowledge_bulk_update",
    {
      title: "Bulk Update Knowledge Docs",
      description: "Update fields of many knowledge docs at once",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().optional(),
              content: z.string().optional(),
              tags: z.array(z.string()).optional(),
              source: z.string().optional(),
              parentId: z.string().nullable().optional(),
              type: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const results: any[] = [];
      for (const it of items) {
        const { id, ...patch } = it as any;
        const d = await updateDoc(prj, id, patch as any);
        if (d) results.push(d);
      }
      return ok({ count: results.length, results });
    }
  );

  // tasks bulk archive/trash/restore/delete
  // internal helpers to centralize bulk logic
  async function bulkCloseTasks(project: string, ids: string[]) {
    const prj = resolveProject(project);
    const results = [] as any[];
    for (const id of ids) {
      const t = await closeTask(prj, id);
      if (t) results.push(t);
    }
    return results;
  }

  async function bulkDeleteTasksPermanent(project: string, ids: string[], confirm?: boolean, dryRun?: boolean) {
    const prj = resolveProject(project);
    if (dryRun) {
      const results = [] as any[];
      for (const id of ids) {
        try {
          const t = await getTask(prj, id);
          if (t) {
            results.push({ ok: true, data: t });
          } else {
            results.push({ ok: false, error: { message: `Task not found: ${project}/${id}` } });
          }
        } catch (e: any) {
          results.push({ ok: false, error: { message: String(e?.message || e) } });
        }
      }
      return { dryRun: true as const, results };
    }

    if (confirm !== true) {
      return { confirmRequired: true as const, results: [] as any[] };
    }

    const results = [] as any[];
    for (const id of ids) {
      const t = await deleteTaskPermanent(prj, id);
      if (t) results.push(t);
    }
    return { dryRun: false as const, results };
  }
  async function bulkTrashTasks(project: string, ids: string[]) {
    const prj = resolveProject(project);
    const results = [] as any[];
    for (const id of ids) {
      const t = await trashTask(prj, id);
      if (t) results.push(t);
    }
    return results;
  }
  async function bulkRestoreTasks(project: string, ids: string[]) {
    const prj = resolveProject(project);
    const results = [] as any[];
    for (const id of ids) {
      const t = await restoreTask(prj, id);
      if (t) results.push(t);
    }
    return results;
  }
  async function bulkCreateTasksHelper(project: string, items: Array<{ title: string; description?: string; priority?: any; tags?: string[]; links?: string[]; parentId?: string }>) {
    const prj = resolveProject(project);
    const created = [] as any[];
    for (const it of items) {
      const t = await createTask({ project: prj, ...it });
      created.push(t);
    }
    return created;
  }
  async function bulkCreateKnowledgeHelper(project: string, items: Array<{ title: string; content: string; tags?: string[]; source?: string; parentId?: string; type?: string }>) {
    const prj = resolveProject(project);
    const created = [] as any[];
    for (const it of items) {
      const d = await createDoc({ project: prj, ...it });
      created.push(d);
    }
    return created;
  }
  // tasks.bulk_create
  server.registerTool(
    "tasks_bulk_create",
    {
      title: "Bulk Create Tasks",
      description: "Create many tasks at once (optionally hierarchical via parentId)",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
              tags: z.array(z.string()).optional(),
              links: z.array(z.string()).optional(),
              parentId: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const created = await bulkCreateTasksHelper(project, items as any);
      const envelope = { ok: true, data: { count: created.length, created } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    }
  );
  server.registerTool(
    "tasks_bulk_archive",
    {
      title: "Bulk Archive Tasks",
      description: "Archive many tasks",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await archiveTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );
  server.registerTool(
    "tasks_bulk_trash",
    {
      title: "Bulk Trash Tasks",
      description: "Move many tasks to trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await trashTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );
  server.registerTool(
    "tasks_bulk_restore",
    {
      title: "Bulk Restore Tasks",
      description: "Restore many tasks from archive/trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const prj = resolveProject(project);
      const results = [] as any[];
      for (const id of ids) {
        const t = await restoreTask(prj, id);
        if (t) results.push(t);
      }
      return ok({ count: results.length, results });
    }
  );
  // tasks.bulk_close
  server.registerTool(
    "tasks_bulk_close",
    {
      title: "Bulk Close Tasks",
      description: "Mark many tasks as closed",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const results = await bulkCloseTasks(project, ids);
      return ok({ count: results.length, results });
    }
  );
  server.registerTool(
    "tasks_bulk_delete_permanent",
    {
      title: "Bulk Delete Tasks Permanently",
      description: "Permanently delete many tasks (use with caution)",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        ids: z.array(z.string().min(1)).min(1).max(200),
        // UX helpers (optional, backward-compatible)
        confirm: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, ids, confirm, dryRun }) => {
      const res = await bulkDeleteTasksPermanent(project, ids, confirm, dryRun);
      if ('confirmRequired' in res && res.confirmRequired) {
        return err('Bulk task delete not confirmed: pass confirm=true to proceed');
      }
      const results = res.results;
      return ok({ count: results.length, results });
    }
  );

  // knowledge bulk archive/trash/restore/delete
  server.registerTool(
    "knowledge_bulk_archive",
    {
      title: "Bulk Archive Knowledge Docs",
      description: "Archive many knowledge docs",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const { knowledgeBulkArchive } = await import('./bulk.js');
      const envelope = await knowledgeBulkArchive(project, ids);
      return ok(envelope);
    }
  );
  server.registerTool(
    "knowledge_bulk_trash",
    {
      title: "Bulk Trash Knowledge Docs",
      description: "Move many knowledge docs to trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const { knowledgeBulkTrash } = await import('./bulk.js');
      const envelope = await knowledgeBulkTrash(project, ids);
      return ok(envelope);
    }
  );
  server.registerTool(
    "knowledge_bulk_restore",
    {
      title: "Bulk Restore Knowledge Docs",
      description: "Restore many knowledge docs from archive/trash",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const { knowledgeBulkRestore } = await import('./bulk.js');
      const envelope = await knowledgeBulkRestore(project, ids);
      return ok(envelope);
    }
  );
  server.registerTool(
    "knowledge_bulk_delete_permanent",
    {
      title: "Bulk Delete Knowledge Docs Permanently",
      description: "Permanently delete many knowledge docs (use with caution)",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), ids: z.array(z.string().min(1)).min(1).max(200) },
    },
    async ({ project, ids }) => {
      const { knowledgeBulkDeletePermanent } = await import('./bulk.js');
      const envelope = await knowledgeBulkDeletePermanent(project, ids);
      return ok(envelope);
    }
  );

  // project.purge — enumerate and permanently delete all tasks and/or knowledge in a project
  server.registerTool(
    "project_purge",
    {
      title: "Project Purge (Destructive)",
      description: "Enumerate and permanently delete ALL tasks and/or knowledge in the project. Requires confirm=true unless dryRun.",
      inputSchema: {
        project: z.string().optional(),
        scope: z.enum(['both','tasks','knowledge']).optional(),
        dryRun: z.boolean().optional(),
        confirm: z.boolean().optional(),
        // common
        includeArchived: z.boolean().optional(),
        // task filters
        tasksStatus: z.union([z.string(), z.array(z.string())]).optional(),
        tasksTags: z.union([z.string(), z.array(z.string())]).optional(),
        tasksParentId: z.string().optional(),
        tasksIncludeDescendants: z.boolean().optional(),
        // knowledge filters
        knowledgeTags: z.union([z.string(), z.array(z.string())]).optional(),
        knowledgeTypes: z.union([z.string(), z.array(z.string())]).optional(),
        knowledgeParentId: z.string().optional(),
        knowledgeIncludeDescendants: z.boolean().optional(),
      },
    },
    async (params: any) => {
      const prj = resolveProject(params?.project);
      const scope = params?.scope || 'both';
      const doTasks = scope === 'both' || scope === 'tasks';
      const doKnowledge = scope === 'both' || scope === 'knowledge';
      const dryRun = !!params?.dryRun;
      const confirm = !!params?.confirm;
      const includeArchived = params?.includeArchived ?? true;

      // list all ids (include archived and trashed)
      const tasks = doTasks ? await listTasks({ project: prj, includeArchived, includeTrashed: true }) : [];
      const docs = doKnowledge ? await listDocs({ project: prj, includeArchived, includeTrashed: true }) : [];

      // normalize filters
      const toArr = (v: any): string[] | undefined => v == null ? undefined : (Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string' && x.trim().length > 0);

      const fTasksStatus = toArr(params?.tasksStatus);
      const fTasksTags = toArr(params?.tasksTags);
      const fTasksParent = (params?.tasksParentId as string | undefined)?.trim();
      const fTasksInclDesc = params?.tasksIncludeDescendants === true;

      const fKTags = toArr(params?.knowledgeTags);
      const fKTypes = toArr(params?.knowledgeTypes);
      const fKParent = (params?.knowledgeParentId as string | undefined)?.trim();
      const fKInclDesc = params?.knowledgeIncludeDescendants === true;

      // Filter tasks
      let filteredTasks = tasks;
      if (fTasksStatus?.length) {
        filteredTasks = filteredTasks.filter((t: any) => fTasksStatus.includes(t.status));
      }
      if (fTasksTags?.length) {
        filteredTasks = filteredTasks.filter((t: any) =>
          t.tags?.some((tag: any) => fTasksTags.includes(tag))
        );
      }
      if (fTasksParent) {
        if (fTasksInclDesc) {
          const descendants = new Set<string>();
          const collectDescendants = (parentId: string) => {
            const children = tasks.filter((t: any) => t.parentId === parentId);
            for (const child of children) {
              descendants.add(child.id);
              collectDescendants(child.id);
            }
          };
          collectDescendants(fTasksParent);
          filteredTasks = filteredTasks.filter((t: any) => 
            t.id === fTasksParent || descendants.has(t.id)
          );
        } else {
          filteredTasks = filteredTasks.filter((t: any) => t.parentId === fTasksParent);
        }
      }
      if (!includeArchived) {
        filteredTasks = filteredTasks.filter((t: any) => !t.archived);
      }

      // Filter knowledge
      let filteredDocs = docs;
      if (fKTags?.length) {
        filteredDocs = filteredDocs.filter((d: any) =>
          d.tags?.some((tag: any) => fKTags.includes(tag))
        );
      }
      if (fKTypes?.length) {
        filteredDocs = filteredDocs.filter((d: any) => fKTypes.includes(d.type));
      }
      if (fKParent) {
        if (fKInclDesc) {
          const descendants = new Set<string>();
          const collectDescendants = (parentId: string) => {
            const children = docs.filter((d: any) => d.parentId === parentId);
            for (const child of children) {
              descendants.add(child.id);
              collectDescendants(child.id);
            }
          };
          collectDescendants(fKParent);
          filteredDocs = filteredDocs.filter((d: any) => 
            d.id === fKParent || descendants.has(d.id)
          );
        } else {
          filteredDocs = filteredDocs.filter((d: any) => d.parentId === fKParent);
        }
      }
      if (!includeArchived) {
        filteredDocs = filteredDocs.filter((d: any) => !d.archived);
      }

      // Collect IDs for deletion
      const taskIds: string[] = filteredTasks.map((t: any) => t.id);
      const knowledgeIds: string[] = filteredDocs.map((d: any) => d.id);

      if (dryRun) {
        return ok({
          project: prj,
          scope,
          dryRun: true,
          doTasks,
          doKnowledge,
          counts: { tasks: taskIds.length, knowledge: knowledgeIds.length }
        });
      }

      // Check confirm for real purge
      if (confirm !== true) {
        // Throw to make client.reject as tests expect rejects.toThrow('Refusing to proceed')
        throw new Error('Refusing to proceed: Project purge not confirmed');
      }

      // Perform deletions
      if (doTasks && taskIds.length) {
        for (const batch of chunkArray(taskIds, 100)) {
          await bulkDeleteTasksPermanent(prj, batch, true, false);
        }
      }
      if (doKnowledge && knowledgeIds.length) {
        for (const batch of chunkArray(knowledgeIds, 100)) {
          for (const id of batch) {
            await deleteDocPermanent(prj, id);
          }
        }
      }

      return ok({
        project: prj,
        scope,
        dryRun: false,
        doTasks,
        doKnowledge,
        counts: { tasks: taskIds.length, knowledge: knowledgeIds.length }
      });
    }
  );

  // tasks.list
  server.registerTool(
    "tasks_list",
    {
      title: "List Tasks",
      description: "List tasks with optional filters",
      inputSchema: {
        project: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, status, tag, includeArchived }) => {
      const prj = resolveProject(project);
      const items = await listTasks({ project: prj, status, tag, includeArchived });
      return ok(items);
    }
  );

  // tasks.tree
  server.registerTool(
    "tasks_tree",
    {
      title: "List Tasks Tree",
      description: "List tasks as a hierarchical tree (by parentId)",
      inputSchema: {
        project: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed", "closed"]).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, status, tag, includeArchived }) => {
      const prj = resolveProject(project);
      const items = await listTasksTree({ project: prj, status, tag, includeArchived });
      return ok(items);
    }
  );

  // tasks.get — получить задачу по id
  server.registerTool(
    "tasks_get",
    {
      title: "Get Task",
      description: "Get task by id",
      inputSchema: { project: z.string().default(DEFAULT_PROJECT), id: z.string().min(1) },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const t = await getTask(prj, id);
      if (!t) {
        return err(`Task not found: ${project}/${id}`);
      }
      return ok(t);
    }
  );

  // knowledge.bulk_create
  server.registerTool(
    "knowledge_bulk_create",
    {
      title: "Bulk Create Knowledge Docs",
      description: "Create many knowledge docs at once (optionally hierarchical via parentId)",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              content: z.string(),
              tags: z.array(z.string()).optional(),
              source: z.string().optional(),
              parentId: z.string().optional(),
              type: z.string().optional(),
            })
          )
          .min(1)
          .max(100),
      },
    },
    async ({ project, items }) => {
      const prj = resolveProject(project);
      const created: any[] = [];
      for (const it of items) {
        const d = await createDoc({ project: prj, ...it });
        created.push(d);
      }
      return ok({ count: created.length, created });
    }
  );

  // knowledge.list
  server.registerTool(
    "knowledge_list",
    {
      title: "List Knowledge Docs",
      description: "List knowledge documents metadata",
      inputSchema: {
        project: z.string().optional(),
        tag: z.string().optional(),
      },
    },
    async ({ project, tag }) => {
      const prj = resolveProject(project);
      const items = await listDocs({ project: prj, tag });
      return ok(items);
    }
  );

  // knowledge.tree
  server.registerTool(
    "knowledge_tree",
    {
      title: "Knowledge Tree",
      description: "List knowledge documents as a hierarchical tree (by parentId)",
      inputSchema: {
        project: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, includeArchived }) => {
      const prj = resolveProject(project);
      const metas = await listDocs({ project: prj });
      const filtered = metas.filter((m) => !m.trashed && (includeArchived ? true : !m.archived));
      const byId = new Map(filtered.map((m) => [m.id, { ...m, children: [] as any[] }]));
      const roots: any[] = [];
      for (const m of byId.values()) {
        if (m.parentId && byId.has(m.parentId)) {
          byId.get(m.parentId)!.children.push(m);
        } else {
          roots.push(m);
        }
      }
      return ok(roots);
    }
  );

  // knowledge.get
  server.registerTool(
    "knowledge_get",
    {
      title: "Get Knowledge Doc",
      description: "Read a knowledge document by id",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1),
      },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const d = await readDoc(prj, id);
      if (!d) {
        return err(`Doc not found: ${project}/${id}`);
      }
      return ok(d);
    }
  );

  // knowledge.bulk_* implemented earlier via ./bulk.js (duplicates removed here)

  // ...
  // search.tasks
  server.registerTool(
    "search_tasks",
    {
      title: "Search Tasks",
      description: "BM25 (and optional vector) search over tasks",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ project, query, limit }) => {
      const prj = resolveProject(project);
      const tasks = await listTasks({ project: prj });
      const items = tasks.map((t) => ({ id: t.id, text: buildTextForTask(t), item: t }));
      const results = await hybridSearch(query, items, { limit: limit ?? 20, vectorAdapter: vectorAdapter });
      return ok(results);
    }
  );

  // search.knowledge
  server.registerTool(
    "search_knowledge",
    {
      title: "Search Knowledge",
      description: "BM25 (and optional vector) search over knowledge docs",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ project, query, limit }: { project?: string; query: string; limit?: number }) => {
      const prj = resolveProject(project);
      const metas = await listDocs({ project: prj });
      const docs = await Promise.all(metas.map((m) => readDoc(m.project || prj, m.id)));
      const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
      const items = valid.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
      const results = await hybridSearch(query, items, { limit: limit ?? 20, vectorAdapter: vectorAdapter });
      return ok(results);
    }
  );

  // search.knowledge_two_stage (BM25 prefilter by docs -> chunked hybrid within top-M)
  server.registerTool(
    "mcp1_search_knowledge_two_stage",
    {
      title: "Search Knowledge (Two-Stage)",
      description:
        "Two-stage search: Stage1 BM25 over docs (prefilter), Stage2 chunked hybrid within top-M long docs. Controls for prefilterLimit/chunkSize/chunkOverlap.",
      inputSchema: {
        project: z.string().optional(),
        query: z.string().min(1),
        prefilterLimit: z.number().int().min(1).max(200).optional(),
        chunkSize: z.number().int().min(200).max(20000).optional(),
        chunkOverlap: z.number().int().min(0).max(5000).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (
      { project, query, prefilterLimit, chunkSize, chunkOverlap, limit }: {
        project?: string;
        query: string;
        prefilterLimit?: number;
        chunkSize?: number;
        chunkOverlap?: number;
        limit?: number;
      }
    ) => {
      const prj = resolveProject(project);
      const metas = await listDocs({ project: prj });
      const docs = await Promise.all(metas.map((m) => readDoc(m.project || prj, m.id)));
      const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
      // Ensure vector adapter only if needed by config/mode
      const va = await ensureVectorAdapter();
      const results = await twoStageHybridKnowledgeSearch(query, valid, {
        prefilterLimit,
        chunkSize,
        chunkOverlap,
        limit,
        vectorAdapter: va as any,
      });
      return ok(results);
    }
  );

  // embeddings.status
  server.registerTool(
    "embeddings_status",
    {
      title: "Embeddings Status",
      description: "Show current embeddings configuration and mode",
      inputSchema: {},
    },
    async () => {
      const c = loadConfig();
      const payload = {
        mode: c.embeddings.mode,
        hasModelPath: Boolean(c.embeddings.modelPath),
        dim: c.embeddings.dim ?? null,
        cacheDir: c.embeddings.cacheDir || null,
        // Do not force init here; report capability based on config only
        vectorAdapterEnabled: Boolean(c.embeddings.modelPath && c.embeddings.dim && c.embeddings.mode !== 'none'),
      };
      return ok(payload);
    }
  );

  

  // (Removed duplicate simplified Obsidian tools registered above with richer UX)

  // project_get_current
  server.registerTool(
    "project_get_current",
    {
      title: "Get Current Project",
      description: "Return the name of the current project context",
      inputSchema: {},
    },
    async () => ok({ project: getCurrentProject() })
  );

  // project_set_current
  server.registerTool(
    "project_set_current",
    {
      title: "Set Current Project",
      description: "Change the current project context used when project is omitted",
      inputSchema: {
        project: z.string().min(1),
      },
    },
    async ({ project }: { project: string }) => ok({ project: setCurrentProject(project) })
  );

  // ===== Project Resources: get current and quick switch =====
  // project://current — return current project
  try {
    server.registerResource(
      "project_current",
      "project://current",
      {
        title: "Current Project",
        description: "Return the current project context",
        mimeType: "application/json",
      },
      async (uri) => {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ project: getCurrentProject() }, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (typeof msg === 'string' && msg.includes('already registered')) {
      console.warn('[resources] already registered: project://current — skipping');
    } else {
      throw e;
    }
  }

  // project://use/{projectId} — switch current project by reading this resource
  try {
    const projectsData = await listProjects(getCurrentProject);
    const projectIds: string[] = (projectsData?.projects || []).map((p: any) => String(p.id));
    for (const pid of projectIds) {
      const uri = `project://use/${encodeURIComponent(pid)}`;
      try {
        server.registerResource(
          `project_use_${pid}`,
          uri,
          {
            title: `Use Project: ${pid}`,
            description: `Switch current project to "${pid}"`,
            mimeType: "application/json",
          },
          async (u) => {
            const next = setCurrentProject(pid);
            return {
              contents: [
                {
                  uri: u.href,
                  text: JSON.stringify({ project: next }, null, 2),
                  mimeType: "application/json",
                },
              ],
            };
          }
        );
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (typeof msg === 'string' && msg.includes('already registered')) {
          console.warn(`[resources] already registered: ${uri} — skipping`);
        } else {
          throw e;
        }
      }
    }
  } catch (e) {
    console.warn('[resources] failed to register project use resources:', e);
  }

  // ===== Tasks by Project Resources =====
  // For each known project, register a static resource:
  //   tasks://project/{id} — lists tasks for that project (non-archived by default)
  try {
    const projectsData2 = await listProjects(getCurrentProject);
    const projectIds2: string[] = (projectsData2?.projects || []).map((p: any) => String(p.id));
    for (const pid of projectIds2) {
      const uri = `tasks://project/${encodeURIComponent(pid)}`;
      try {
        server.registerResource(
          `tasks_project_${pid}`,
          uri,
          {
            title: `Tasks for Project: ${pid}`,
            description: `List tasks for project "${pid}" (includeArchived=false)`,
            mimeType: "application/json",
          },
          async (u) => {
            try {
              const items = await listTasks({ project: pid, includeArchived: false });
              return {
                contents: [
                  {
                    uri: u.href,
                    text: JSON.stringify(items, null, 2),
                    mimeType: "application/json",
                  },
                ],
              };
            } catch (e: any) {
              return {
                contents: [
                  {
                    uri: u.href,
                    text: JSON.stringify({ error: e?.message || String(e) }, null, 2),
                    mimeType: "application/json",
                  },
                ],
              };
            }
          }
        );
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (typeof msg === 'string' && msg.includes('already registered')) {
          console.warn(`[resources] already registered: ${uri} — skipping`);
        } else {
          throw e;
        }
      }
    }
  } catch (e) {
    console.warn('[resources] failed to register tasks by project resources:', e);
  }

  // ===== Search Recent Static Aliases by Project =====
  // Register exact URIs so clients that require exact resource keys can read them directly
  try {
    const projectsData3 = await listProjects(getCurrentProject);
    const projectIds3: string[] = (projectsData3?.projects || []).map((p: any) => String(p.id));
    for (const pid of projectIds3) {
      // search://tasks/{project}/recent
      try {
        const uri = `search://tasks/${encodeURIComponent(pid)}/recent`;
        server.registerResource(
          `search_tasks_${pid}_recent`,
          uri,
          { title: `Search Tasks Recent: ${pid}`, description: `Recent tasks for project "${pid}"`, mimeType: 'application/json' },
          async (u) => {
            const items: any[] = await listTasks({ project: pid, includeArchived: false } as any);
            items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
            return { contents: [{ uri: u.href, text: JSON.stringify(items.slice(0, 20), null, 2), mimeType: 'application/json' }] };
          }
        );
      } catch (e: any) { const m = e?.message || String(e); if (!(typeof m === 'string' && m.includes('already registered'))) throw e; }

      // search://knowledge/{project}/recent
      try {
        const uri = `search://knowledge/${encodeURIComponent(pid)}/recent`;
        server.registerResource(
          `search_knowledge_${pid}_recent`,
          uri,
          { title: `Search Knowledge Recent: ${pid}`, description: `Recent knowledge for project "${pid}"`, mimeType: 'application/json' },
          async (u) => {
            const items: any[] = await listDocs({ project: pid, includeArchived: false } as any);
            const sorted = items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
            return { contents: [{ uri: u.href, text: JSON.stringify(sorted.slice(0, 20), null, 2), mimeType: 'application/json' }] };
          }
        );
      } catch (e: any) { const m = e?.message || String(e); if (!(typeof m === 'string' && m.includes('already registered'))) throw e; }
    }
  } catch (e) {
    console.warn('[resources] failed to register search recent aliases:', e);
  }

  // ===== Project: list and refresh resources =====
  try {
    server.registerResource(
      'project_list',
      'project://projects',
      {
        title: 'Projects List',
        description: 'List known projects (current/default flags included)',
        mimeType: 'application/json',
      },
      async (u) => {
        const data = await listProjects(getCurrentProject);
        return { contents: [{ uri: u.href, text: JSON.stringify(data, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (typeof msg === 'string' && msg.includes('already registered')) {
      console.warn('[resources] already registered: project://projects — skipping');
    } else { throw e; }
  }

  try {
    server.registerResource(
      'project_refresh',
      'project://refresh',
      {
        title: 'Project Resources Refresh',
        description: 'Re-scan projects and ensure per-project aliases are registered',
        mimeType: 'application/json',
      },
      async (u) => {
        const projectsData = await listProjects(getCurrentProject);
        const projectIds: string[] = (projectsData?.projects || []).map((p: any) => String(p.id));
        let ensured = 0;
        for (const pid of projectIds) {
          const useUri = `project://use/${encodeURIComponent(pid)}`;
          try {
            server.registerResource(
              `project_use_${pid}`,
              useUri,
              { title: `Use Project: ${pid}`, description: `Switch current project to "${pid}"`, mimeType: 'application/json' },
              async (x) => ({ contents: [{ uri: x.href, text: JSON.stringify({ project: setCurrentProject(pid) }, null, 2), mimeType: 'application/json' }] })
            );
            ensured++;
          } catch (e: any) {
            const m = e?.message || String(e);
            if (!(typeof m === 'string' && m.includes('already registered'))) throw e;
          }
          try {
            server.registerResource(
              `tasks_project_${pid}`,
              `tasks://project/${encodeURIComponent(pid)}`,
              { title: `Tasks for Project: ${pid}`, description: `List tasks for project "${pid}"`, mimeType: 'application/json' },
              async (x) => {
                const items = await listTasks({ project: pid, includeArchived: false });
                return { contents: [{ uri: x.href, text: JSON.stringify(items, null, 2), mimeType: 'application/json' }] };
              }
            );
            ensured++;
          } catch (e: any) {
            const m = e?.message || String(e);
            if (!(typeof m === 'string' && m.includes('already registered'))) throw e;
          }
          // Ensure static search recent aliases
          try {
            const uri = `search://tasks/${encodeURIComponent(pid)}/recent`;
            server.registerResource(
              `search_tasks_${pid}_recent`,
              uri,
              { title: `Search Tasks Recent: ${pid}`, description: `Recent tasks for project "${pid}"`, mimeType: 'application/json' },
              async (x) => {
                const items: any[] = await listTasks({ project: pid, includeArchived: false } as any);
                items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
                return { contents: [{ uri: x.href, text: JSON.stringify(items.slice(0, 20), null, 2), mimeType: 'application/json' }] };
              }
            );
            ensured++;
          } catch (e: any) { const m = e?.message || String(e); if (!(typeof m === 'string' && m.includes('already registered'))) throw e; }
          try {
            const uri = `search://knowledge/${encodeURIComponent(pid)}/recent`;
            server.registerResource(
              `search_knowledge_${pid}_recent`,
              uri,
              { title: `Search Knowledge Recent: ${pid}`, description: `Recent knowledge for project "${pid}"`, mimeType: 'application/json' },
              async (x) => {
                const items: any[] = await listDocs({ project: pid, includeArchived: false } as any);
                const sorted = items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
                return { contents: [{ uri: x.href, text: JSON.stringify(sorted.slice(0, 20), null, 2), mimeType: 'application/json' }] };
              }
            );
            ensured++;
          } catch (e: any) { const m = e?.message || String(e); if (!(typeof m === 'string' && m.includes('already registered'))) throw e; }
        }
        return { contents: [{ uri: u.href, text: JSON.stringify({ ok: true, ensured }, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (typeof msg === 'string' && msg.includes('already registered')) {
      console.warn('[resources] already registered: project://refresh — skipping');
    } else { throw e; }
  }

  // ===== Tasks Aliases (current) and Dynamic Filters =====
  try {
    server.registerResource(
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
    server.registerResource(
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
    server.registerResource(
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

  // ===== Knowledge Aliases and Dynamic Filters =====
  try {
    server.registerResource(
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
    server.registerResource(
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
    server.registerResource(
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

  // [removed] POST-like resource creators (tasks://create, knowledge://create) — use tools.run instead
  // This block intentionally left blank

  // ===== Task Actions via Resource (Exact URI) =====
  // task://action/{project}/{id}/{action}
  // action ∈ start | complete | close | trash | restore | archive
  try {
    server.registerResource(
      'task_action',
      'task://action',
      { title: 'Task Action', description: 'Change task status via exact URI: task://action/{project}/{id}/{action}', mimeType: 'application/json' },
      async (u) => {
        const href = u.href;
        const m = href.match(/^task:\/\/action\/([^\/]+)\/([^\/]+)\/(start|complete|close|trash|restore|archive)$/);
        if (!m) {
          return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'invalid task action path', example: 'task://action/{project}/{id}/{start|complete|close|trash|restore|archive}' }, null, 2), mimeType: 'application/json' }] };
        }
        const project = decodeURIComponent(m[1]);
        const id = decodeURIComponent(m[2]);
        const action = m[3] as 'start'|'complete'|'close'|'trash'|'restore'|'archive';
        try {
          let payload: any = null;
          if (action === 'start') payload = await updateTask(project, id, { status: 'in_progress' } as any);
          else if (action === 'complete') payload = await updateTask(project, id, { status: 'completed' } as any);
          else if (action === 'close') payload = await closeTask(project, id);
          else if (action === 'trash') payload = await trashTask(project, id);
          else if (action === 'restore') payload = await restoreTask(project, id);
          else if (action === 'archive') payload = await archiveTask(project, id);
          return { contents: [{ uri: href, text: JSON.stringify({ ok: true, project, id, action, data: payload ?? null }, null, 2), mimeType: 'application/json' }] };
        } catch (e: any) {
          return { contents: [{ uri: href, text: JSON.stringify({ ok: false, project, id, action, error: e?.message || String(e) }, null, 2), mimeType: 'application/json' }] };
        }
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: task://action — skipping'); else throw e; }

  // ===== Search Aliases =====
  try {
    server.registerResource(
      'search_tasks',
      'search://tasks',
      { title: 'Search Tasks', description: 'Dynamic: /{project}/{paramsB64} or /{project}/recent', mimeType: 'application/json' },
      async (u) => {
        const href = u.href;
        const recentM = href.match(/^search:\/\/tasks\/([^\/]+)\/recent$/);
        if (recentM) {
          const project = decodeURIComponent(recentM[1]);
          const items: any[] = await listTasks({ project, includeArchived: false } as any);
          items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          return { contents: [{ uri: href, text: JSON.stringify(items.slice(0, 20), null, 2), mimeType: 'application/json' }] };
        }
        const paramM = href.match(/^search:\/\/tasks\/([^\/]+)\/([^\/]+)$/);
        if (paramM) {
          const project = decodeURIComponent(paramM[1]);
          const paramsB64 = decodeURIComponent(paramM[2]);
          let params: any = {};
          try { params = JSON.parse(Buffer.from(normalizeBase64(paramsB64), 'base64').toString('utf8')); }
          catch {
            try { params = JSON.parse(decodeURIComponent(paramsB64)); } catch {}
          }
          const query: string = String(params.query || '').trim();
          const limit: number = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
          const tasks = await listTasks({ project, includeArchived: false } as any);
          const items = tasks.map(t => ({ id: t.id, text: buildTextForTask(t), item: t }));
          const results = await hybridSearch(query, items, { limit, vectorAdapter: await ensureVectorAdapter() });
          return { contents: [{ uri: href, text: JSON.stringify(results, null, 2), mimeType: 'application/json' }] };
        }
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'unsupported search://tasks path' }, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: search://tasks — skipping'); else throw e; }

  try {
    server.registerResource(
      'search_knowledge',
      'search://knowledge',
      { title: 'Search Knowledge', description: 'Dynamic: /{project}/{paramsB64} or /{project}/recent', mimeType: 'application/json' },
      async (u) => {
        const href = u.href;
        const recentM = href.match(/^search:\/\/knowledge\/([^\/]+)\/recent$/);
        if (recentM) {
          const project = decodeURIComponent(recentM[1]);
          const items: any[] = await listDocs({ project, includeArchived: false } as any);
          const sorted = items.sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
          return { contents: [{ uri: href, text: JSON.stringify(sorted.slice(0, 20), null, 2), mimeType: 'application/json' }] };
        }
        const paramM = href.match(/^search:\/\/knowledge\/([^\/]+)\/([^\/]+)$/);
        if (paramM) {
          const project = decodeURIComponent(paramM[1]);
          const paramsB64 = decodeURIComponent(paramM[2]);
          let params: any = {};
          try { params = JSON.parse(Buffer.from(normalizeBase64(paramsB64), 'base64').toString('utf8')); }
          catch { try { params = JSON.parse(decodeURIComponent(paramsB64)); } catch {} }
          const query: string = String(params.query || '').trim();
          const limit: number = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
          const metas = await listDocs({ project, includeArchived: false } as any);
          const docs = (await Promise.all(metas.map(async (m: any) => await readDoc(project, m.id)))).filter(Boolean) as any[];
          const results = await twoStageHybridKnowledgeSearch(query, docs as any, { limit, vectorAdapter: await ensureVectorAdapter() });
          return { contents: [{ uri: href, text: JSON.stringify(results, null, 2), mimeType: 'application/json' }] };
        }
        return { contents: [{ uri: href, text: JSON.stringify({ ok: false, error: 'unsupported search://knowledge path' }, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: search://knowledge — skipping'); else throw e; }

  // Introspection tools (canonical names only; no aliases). Use the in-memory toolRegistry.
  server.registerTool(
    "tools_list",
    {
      title: "List Registered Tools",
      description: "Return list of canonical tool names with metadata (title, description, input keys)",
      inputSchema: {},
    },
    async () => ok(Array.from(toolRegistry.entries()).map(([name, meta]) => ({
      name,
      title: meta?.title ?? null,
      description: meta?.description ?? null,
      inputKeys: meta?.inputSchema ? Object.keys(meta.inputSchema) : [],
    })))
  );

  function buildExampleFor(name: string, meta: { inputSchema?: Record<string, any> } | undefined) {
    const ex: Record<string, any> = {};
    const keys = meta?.inputSchema ? Object.keys(meta.inputSchema) : [];
    for (const k of keys) {
      const key = String(k);
      if (key === 'project') ex[key] = getCurrentProject();
      else if (key === 'id') ex[key] = '00000000-0000-0000-0000-000000000000';
      else if (key === 'ids') ex[key] = ['00000000-0000-0000-0000-000000000000'];
      else if (key === 'title') ex[key] = 'Example Title';
      else if (key === 'description') ex[key] = 'Example Description';
      else if (key === 'content') ex[key] = 'Example Content';
      else if (key === 'tags') ex[key] = ['example'];
      else if (key === 'links') ex[key] = ['https://example.com'];
      else if (key === 'parentId') ex[key] = null;
      else if (key === 'status') ex[key] = 'pending';
      else if (key === 'priority') ex[key] = 'medium';
      else if (key === 'confirm') ex[key] = true;
      else if (key === 'dryRun') ex[key] = false;
      else if (key === 'knowledge' || key === 'tasks' || key === 'overwriteByTitle') ex[key] = true;
      // Prompts-related flags (export/import)
      else if (key === 'prompts') ex[key] = true;
      else if (key === 'includePromptSourcesJson') ex[key] = true;
      else if (key === 'includePromptSourcesMd') ex[key] = true;
      else if (key === 'importPromptSourcesJson') ex[key] = true;
      else if (key === 'importPromptMarkdown') ex[key] = true;
      else if (key === 'keepOrphans') ex[key] = false;
      else if (key === 'strategy') ex[key] = 'merge';
      else if (key === 'mergeStrategy') ex[key] = 'overwrite';
      else if (key === 'query') ex[key] = 'example';
      else if (key === 'texts') ex[key] = ['text'];
      else if (key === 'limit') ex[key] = 10;
      else if (key === 'prefilterLimit') ex[key] = 20;
      else if (key === 'chunkSize') ex[key] = 1000;
      else if (key === 'chunkOverlap') ex[key] = 200;
      else if (key === 'tag') ex[key] = 'example';
      else if (key === 'includeArchived') ex[key] = false;
      else if (key === 'updatedFrom') ex[key] = '2025-01-01T00:00:00Z';
      else if (key === 'updatedTo') ex[key] = '2025-12-31T23:59:59Z';
      else if (key === 'type') ex[key] = 'note';
      else if (key === 'includePaths' || key === 'excludePaths') ex[key] = ['Knowledge/**/*.md', 'Tasks/**/*.md'];
      else if (key === 'includeTags' || key === 'excludeTags') ex[key] = ['tag1', 'tag2'];
      else if (key === 'includeTypes') ex[key] = ['note', 'spec'];
      else if (key === 'includeStatus') ex[key] = ['pending', 'in_progress'];
      else if (key === 'includePriority') ex[key] = ['high', 'medium'];
      else ex[key] = 'example';
    }
    return ex;
  }

  server.registerTool(
    "tool_schema",
    {
      title: "Tool Schema",
      description: "Return metadata and example payload for a tool name",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }: { name: string }) => {
      const meta = toolRegistry.get(name);
      if (!meta) return err(`Tool not found: ${name}`);
      const example = buildExampleFor(name, meta);
      const payload = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
        example,
      };
      return ok(payload);
    }
  );

  server.registerTool(
    "tool_help",
    {
      title: "Tool Help",
      description: "Short help for a tool with an example call",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }: { name: string }) => {
      const meta = toolRegistry.get(name);
      if (!meta) return err(`Tool not found: ${name}`);
      const example = buildExampleFor(name, meta);
      const help = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        exampleCall: { name, params: example },
      };
      return ok(help);
    }
  );

  // tools_run — bulk executor for tools via RPC (not a resource)
  server.registerTool(
    "tools_run",
    {
      title: "Tools Run (Bulk)",
      description: "Execute one or many tools by name with params via RPC.",
      inputSchema: {
        name: z.string().optional(),
        params: z.any().optional(),
        items: z.array(z.object({ name: z.string(), params: z.any().optional() })).optional(),
        stopOnError: z.boolean().optional(),
      },
    },
    async ({ name, params, items, stopOnError }: { name?: string; params?: any; items?: Array<{ name: string; params?: any }>; stopOnError?: boolean }) => {
      const runs: Array<{ name: string; params?: any }> = [];
      if (Array.isArray(items) && items.length > 0) runs.push(...items.map((i) => ({ name: i.name, params: i.params })));
      if (name) runs.push({ name, params });
      if (runs.length === 0) return err('no tool specified');

      const results: any[] = [];
      for (const r of runs) {
        const meta = toolRegistry.get(r.name);
        if (!meta || typeof meta.handler !== 'function') {
          const e = { name: r.name, ok: false, error: `Tool not found or not executable: ${r.name}` };
          results.push(e);
          if (stopOnError) break;
          continue;
        }
        try {
          const res = await meta.handler(r.params ?? {});
          let payload: any = res;
          try {
            const maybe = (res as any)?.content?.[0]?.text;
            if (typeof maybe === 'string' && maybe.trim().length > 0) payload = JSON.parse(maybe);
          } catch {}
          // Unwrap standard envelope { ok, data } or SDK-like { isError, content }
          let okFlag = true;
          let dataOut: any = payload;
          let errOut: any = undefined;
          if (payload && typeof payload === 'object') {
            if (typeof (payload as any).ok === 'boolean') okFlag = (payload as any).ok === true;
            if (Object.prototype.hasOwnProperty.call(payload, 'data')) dataOut = (payload as any).data;
            if ((payload as any).isError === true) okFlag = false;
            if (!okFlag && Object.prototype.hasOwnProperty.call(payload as any, 'error')) {
              const e = (payload as any).error;
              errOut = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : e;
            }
          }
          results.push({ name: r.name, ok: okFlag, data: okFlag ? dataOut : undefined, error: okFlag ? undefined : (errOut ?? 'error') });
        } catch (e: any) {
          results.push({ name: r.name, ok: false, error: e?.message || String(e) });
          if (stopOnError) break;
        }
      }
      return ok({ count: results.length, results });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
