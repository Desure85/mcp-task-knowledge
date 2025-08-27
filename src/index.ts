import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_PROJECT, loadConfig, resolveProject, getCurrentProject, setCurrentProject, loadCatalogConfig, TASKS_DIR, KNOWLEDGE_DIR, isCatalogEnabled, isCatalogReadEnabled, isCatalogWriteEnabled } from "./config.js";
import { createServiceCatalogProvider } from "./catalog/provider.js";
 import { createTask, listTasks, updateTask, closeTask, listTasksTree, archiveTask, trashTask, restoreTask, deleteTaskPermanent, getTask } from "./storage/tasks.js";
import { createDoc, listDocs, readDoc, updateDoc, archiveDoc, trashDoc, restoreDoc, deleteDocPermanent } from "./storage/knowledge.js";
import { buildTextForDoc, buildTextForTask, hybridSearch, twoStageHybridKnowledgeSearch } from "./search/index.js";
import { getVectorAdapter } from "./search/vector.js";
import { exportProjectToVault, planExportProjectToVault } from "./obsidian/export.js";
import { importProjectFromVault, planImportProjectFromVault } from "./obsidian/import.js";
import { listProjects } from "./projects.js";

async function main() {
  const server = new McpServer({ name: "mcp-task-knowledge", version: "0.1.0" });
  console.error('[startup] mcp-task-knowledge starting...', { ts: new Date().toISOString(), pid: process.pid });
  let cfg: ReturnType<typeof loadConfig>;
  try {
    cfg = loadConfig();
  } catch (e: any) {
    console.error('[startup][config] loadConfig failed. Ensure DATA_DIR and OBSIDIAN_VAULT_ROOT are set. Error:', e?.message || String(e));
    throw e;
  }
  const catalogCfg = loadCatalogConfig();
  console.error('[startup][catalog]', { mode: catalogCfg.mode, prefer: catalogCfg.prefer, remoteEnabled: catalogCfg.remote.enabled, hasRemoteBaseUrl: Boolean(catalogCfg.remote.baseUrl), embeddedEnabled: catalogCfg.embedded.enabled, embeddedStore: catalogCfg.embedded.store });
  const catalogProvider = createServiceCatalogProvider(catalogCfg);
  console.error('[startup][embeddings]', { mode: cfg.embeddings.mode, hasModelPath: Boolean(cfg.embeddings.modelPath), dim: cfg.embeddings.dim ?? null, cacheDir: cfg.embeddings.cacheDir || null });
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

  // Simple in-memory registry of tools for introspection (no aliases)
  const toolRegistry: Map<string, { title?: string; description?: string; inputSchema?: Record<string, any> }> = new Map();

  // Сделать регистрацию инструментов идемпотентной, чтобы не падать при повторном старте/горячей перезагрузке
  // и попытке повторной регистрации того же имени инструмента в одном процессе.
  // Патчим метод registerTool так, чтобы молча игнорировать ошибку "already registered".
  (server as any).registerTool = ((orig: any) => {
    return function (name: string, def: any, handler: any) {
      try {
        const res = orig.call(server, name, def, handler);
        try {
          // Best-effort: keep minimal metadata for introspection
          toolRegistry.set(name, {
            title: def?.title,
            description: def?.description,
            inputSchema: def?.inputSchema,
          });
        } catch {}
        return res;
      } catch (e: any) {
        if (e && typeof e.message === 'string' && e.message.includes('already registered')) {
          // Тихо пропускаем повторную регистрацию
          try {
            // Preserve the newest metadata if possible
            toolRegistry.set(name, {
              title: def?.title,
              description: def?.description,
              inputSchema: def?.inputSchema,
            });
          } catch {}
          return;
        }
        throw e;
      }
    };
  })((server as any).registerTool);

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
          const envelope = { ok: true, data: page };
          return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
        } catch (e: any) {
          const envelope = { ok: false, error: { message: `service-catalog query failed: ${e?.message || String(e)}` } };
          return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
        }
      }
    );
  } else {
    console.warn('[startup][catalog] catalog read disabled — query tool will not be registered');
  }

  // obsidian_export_project
  server.registerTool(
    "obsidian_export_project",
    {
      title: "Export Project to Obsidian Vault",
      description: "Export knowledge and tasks to Obsidian vault (merge or replace). Use with caution in replace mode.",
      inputSchema: {
        project: z.string().optional(),
        knowledge: z.boolean().optional(),
        tasks: z.boolean().optional(),
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
    async ({ project, knowledge, tasks, strategy, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans, confirm, dryRun }: { project?: string; knowledge?: boolean; tasks?: boolean; strategy?: 'merge' | 'replace'; includeArchived?: boolean; updatedFrom?: string; updatedTo?: string; includeTags?: string[]; excludeTags?: string[]; includeTypes?: string[]; excludeTypes?: string[]; includeStatus?: Array<'pending'|'in_progress'|'completed'|'closed'>; includePriority?: Array<'low'|'medium'|'high'>; keepOrphans?: boolean; confirm?: boolean; dryRun?: boolean }) => {
      const cfg = loadConfig();
      const prj = resolveProject(project);
      const doKnowledge = knowledge !== false;
      const doTasks = tasks !== false;
      const strat = strategy || 'merge';

      if (dryRun) {
        const plan = await planExportProjectToVault(prj, {
          knowledge: doKnowledge,
          tasks: doTasks,
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
        const envelope = {
          ok: true,
          data: {
            project: prj,
            strategy: strat,
            knowledge: doKnowledge,
            tasks: doTasks,
            plan: {
              willWrite: { knowledgeCount: plan.knowledgeCount, tasksCount: plan.tasksCount },
              willDeleteDirs: plan.willDeleteDirs,
            },
          },
        };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      }

      if (strat === 'replace' && confirm !== true) {
        const envelope = { ok: false, error: { message: 'Export replace not confirmed: pass confirm=true to proceed' } };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
      }

      try {
        const result = await exportProjectToVault(prj, { knowledge: doKnowledge, tasks: doTasks, strategy: strat, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans });
        const envelope = { ok: true, data: result };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (e: any) {
        const envelope = { ok: false, error: { message: String(e?.message || e) } };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
    }
  );

  // obsidian_import_project
  server.registerTool(
    "obsidian_import_project",
    {
      title: "Import Project from Obsidian Vault",
      description: "Import knowledge and tasks from Obsidian vault. Replace strategy deletes existing content — use with caution.",
      inputSchema: {
        project: z.string().optional(),
        knowledge: z.boolean().optional(),
        tasks: z.boolean().optional(),
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
    async ({ project, knowledge, tasks, overwriteByTitle, strategy, mergeStrategy, includePaths, excludePaths, includeTags, excludeTags, includeTypes, includeStatus, includePriority, confirm, dryRun }: { project?: string; knowledge?: boolean; tasks?: boolean; overwriteByTitle?: boolean; strategy?: 'merge' | 'replace'; mergeStrategy?: 'overwrite' | 'append' | 'skip' | 'fail'; includePaths?: string[]; excludePaths?: string[]; includeTags?: string[]; excludeTags?: string[]; includeTypes?: string[]; includeStatus?: Array<'pending'|'in_progress'|'completed'|'closed'>; includePriority?: Array<'low'|'medium'|'high'>; confirm?: boolean; dryRun?: boolean }) => {
      // Ensure config is loaded (validates DATA_DIR/VAULT envs and logs diagnostics)
      const cfg = loadConfig();
      const prj = resolveProject(project);
      const doKnowledge = knowledge !== false;
      const doTasks = tasks !== false;
      const strat = strategy || 'merge';
      const mstrat = mergeStrategy || 'overwrite';

      const commonOpts = {
        knowledge: doKnowledge,
        tasks: doTasks,
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
          const envelope = {
            ok: true,
            data: {
              project: prj,
              strategy: strat,
              mergeStrategy: mstrat,
              knowledge: doKnowledge,
              tasks: doTasks,
              plan,
            },
          };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
        } catch (e: any) {
          const envelope = { ok: false, error: { message: String(e?.message || e) } };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
        }
      }

      // Replace requires explicit confirmation
      if (strat === 'replace' && confirm !== true) {
        const envelope = { ok: false, error: { message: 'Import replace not confirmed: pass confirm=true to proceed' } };
        // Intentionally do NOT set isError to ensure clients receive JSON text consistently
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      }

      // Execute import
      try {
        const result = await importProjectFromVault(prj, commonOpts as any);
        const envelope = { ok: true, data: result };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
      } catch (e: any) {
        const envelope = { ok: false, error: { message: String(e?.message || e) } };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
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
      const envelope = { ok: true, data: out };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: result };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
        const envelope = { ok: true, data: h };
        return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
          const envelope = { ok: true, data: res };
          return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
        } catch (e: any) {
          const envelope = { ok: false, error: { message: `service-catalog upsert failed: ${e?.message || String(e)}` } };
          return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
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
          const envelope = { ok: true, data: res };
          return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
        } catch (e: any) {
          const envelope = { ok: false, error: { message: `service-catalog delete failed: ${e?.message || String(e)}` } };
          return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
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
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
        const envelope = { ok: false, error: { message: 'Bulk task delete not confirmed: pass confirm=true to proceed' } };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
      const results = res.results;
      const envelope = { ok: true, data: { count: results.length, results } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
        const result = { 
          ok: true, 
          data: { 
            project: prj,
            scope,
            dryRun: true,
            doTasks,
            doKnowledge,
            counts: { tasks: taskIds.length, knowledge: knowledgeIds.length }
          } 
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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

      const result = { 
        ok: true, 
        data: { 
          project: prj,
          scope,
          dryRun: false,
          doTasks,
          doKnowledge,
          counts: { tasks: taskIds.length, knowledge: knowledgeIds.length }
        } 
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
      const envelope = { ok: true, data: items };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: items };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
        const envelope = { ok: false, error: { message: `Task not found: ${project}/${id}` } };
        return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
      const envelope = { ok: true, data: t };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: created.length, created } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: items };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: roots };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
        const envelope = { ok: false, error: { message: `Doc not found: ${project}/${id}` } };
        return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
      const envelope = { ok: true, data: d };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: results };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const docs = await Promise.all(metas.map((m) => readDoc(m.project, m.id)));
      const valid = docs.filter(Boolean) as NonNullable<typeof docs[number]>[];
      const items = valid.map((d) => ({ id: d.id, text: buildTextForDoc(d), item: d }));
      const results = await hybridSearch(query, items, { limit: limit ?? 20, vectorAdapter: vectorAdapter });
      const envelope = { ok: true, data: results };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    }
  );

  // search.knowledge_two_stage (BM25 prefilter by docs -> chunked hybrid within top-M)
  server.registerTool(
    "search_knowledge_two_stage",
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
      const docs = await Promise.all(metas.map((m) => readDoc(m.project, m.id)));
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
      const envelope = { ok: true, data: results };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: payload };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
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
    async () => {
      const envelope = { ok: true, data: { project: getCurrentProject() } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    }
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
    async ({ project }: { project: string }) => {
      const after = setCurrentProject(project);
      const envelope = { ok: true, data: { project: after } };
      return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
    }
  );

  // Introspection tools (canonical names only; no aliases). Use the in-memory toolRegistry.
  server.registerTool(
    "tools_list",
    {
      title: "List Registered Tools",
      description: "Return list of canonical tool names with metadata (title, description, input keys)",
      inputSchema: {},
    },
    async () => {
      const items = Array.from(toolRegistry.entries()).map(([name, meta]) => ({
        name,
        title: meta?.title ?? null,
        description: meta?.description ?? null,
        inputKeys: meta?.inputSchema ? Object.keys(meta.inputSchema) : [],
      }));
      const envelope = { ok: true, data: items };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    }
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
      else if (key === 'strategy') ex[key] = 'merge';
      else if (key === 'query') ex[key] = 'example';
      else if (key === 'texts') ex[key] = ['text'];
      else if (key === 'limit') ex[key] = 10;
      else if (key === 'prefilterLimit') ex[key] = 20;
      else if (key === 'chunkSize') ex[key] = 1000;
      else if (key === 'chunkOverlap') ex[key] = 200;
      else if (key === 'tag') ex[key] = 'example';
      else if (key === 'includeArchived') ex[key] = false;
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
      if (!meta) {
        const envelope = { ok: false, error: { message: `Tool not found: ${name}` } };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
      const example = buildExampleFor(name, meta);
      const payload = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
        example,
      };
      const envelope = { ok: true, data: payload };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      if (!meta) {
        const envelope = { ok: false, error: { message: `Tool not found: ${name}` } };
        return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: true };
      }
      const example = buildExampleFor(name, meta);
      const help = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        exampleCall: { name, params: example },
      };
      const envelope = { ok: true, data: help };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
