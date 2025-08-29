import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_PROJECT, loadConfig, resolveProject, getCurrentProject, setCurrentProject, loadCatalogConfig, TASKS_DIR, KNOWLEDGE_DIR, isCatalogEnabled, isCatalogReadEnabled, isCatalogWriteEnabled, PROMPTS_DIR } from "./config.js";
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
      const envelope = data ? { ok: true, data } : { ok: false, error: { message: 'catalog not found' } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: !data };
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
      const ok = results.every((r) => !r.error);
      const envelope = { ok, data: { project: prj, results } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: !ok };
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
      const ok = results.every((r) => !r.error);
      const envelope = { ok, data: { project: prj, results } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: !ok };
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
      const ok = results.every((r) => !r.error);
      const envelope = { ok, data: { project: prj, results, dryRun: !!dryRun } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }], isError: !ok };
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
      const envelope = { ok: true, data: { path: file, appended } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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

      const envelope = { ok: true, data: { ...outReport, path: pathOut } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { generatedAt: new Date().toISOString(), total: items.length, items } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { path: file, total: lines.length, valid, invalid, samples } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { baseDir: base, files } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    }
  );

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
      const envelope = { ok: true, data: mapped };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { promptKey, variants } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { promptKey, stats: rows } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: assignment };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
      const envelope = { ok: true, data: { count: enriched.length, aggregates: aggr } };
      return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
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
        const envelope = {
          ok: true,
          data: {
            project: prj,
            strategy: strat,
            knowledge: doKnowledge,
            tasks: doTasks,
            prompts: doPrompts,
            plan: {
              willWrite: { knowledgeCount: plan.knowledgeCount, tasksCount: plan.tasksCount, promptsCount: plan.promptsCount },
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
        const result = await exportProjectToVault(prj, { knowledge: doKnowledge, tasks: doTasks, prompts: doPrompts, includePromptSourcesJson, includePromptSourcesMd, strategy: strat, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans });
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
          const envelope = {
            ok: true,
            data: {
              project: prj,
              strategy: strat,
              mergeStrategy: mstrat,
              knowledge: doKnowledge,
              tasks: doTasks,
              prompts: doPrompts,
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
