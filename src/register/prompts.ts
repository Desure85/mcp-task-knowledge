import type { ServerContext } from './context.js';
import { z } from 'zod';
import { PROMPTS_DIR, resolveProject } from '../config.js';
import { ok, err } from '../utils/respond.js';
import { buildWorkflows } from '../prompts/build.js';
import { readPromptsCatalog, readPromptBuildItems, findFileByIdVersion, ensureDirForFile, listFilesRecursive, appendJsonl, readJsonl } from './helpers.js';
import { appendAssignments, appendEvents, listBuildVariants, readExperiment, readAggregates, updateAggregates } from '../ab-testing/storage.js';
import { pickWithEpsilonGreedy } from '../ab-testing/bandits.js';
import { hybridSearch } from '../search/index.js';
import { listTasks } from '../storage/tasks.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';

export function registerPromptsTools(ctx: ServerContext) {
  ctx.server.registerTool(
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
      for (const t of tasks) {
        const nodeId = `T_${t.id}`;
        lines.push(`${nodeId}["task: ${label(t.title)}"]`);
      }
      for (const m of kMetas) {
        const nodeId = `K_${m.id}`;
        lines.push(`${nodeId}["doc: ${label(m.title)}"]`);
      }
      for (const t of tasks) {
        if (t.parentId && tasks.find((x) => x.id === t.parentId)) {
          lines.push(`T_${t.id} --> T_${t.parentId}`);
        }
      }
      for (const m of kMetas) {
        if ((m as any).parentId && kMetas.find((x) => x.id === (m as any).parentId)) {
          lines.push(`K_${m.id} --> K_${(m as any).parentId}`);
        }
      }
      const mermaid = lines.join('\n');
      return ok({ project: prj, mermaid });
    }
  );

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

  ctx.server.registerTool(
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
      if (results.some((r) => r.path && !r.error) && ctx.triggerPromptsReindex) {
        void ctx.triggerPromptsReindex(prj);
      }
      return allOk ? ok({ project: prj, results }) : err('some items failed; see results');
    }
  );

  ctx.server.registerTool(
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
          const errs = validatePromptMinimal(updated);
          if (errs.length) throw new Error(`validation failed: ${errs.join('; ')}`);
          const kind = updated?.metadata?.kind || 'prompt';
          const dstDir = dirForKind(prj, kind);
          await ensureDir(dstDir);
          const dstFile = path.join(dstDir, `${updated.id}@${updated.version}.json`);
          await fs.writeFile(dstFile, JSON.stringify(updated, null, 2) + '\n', 'utf8');
          if (dstFile !== targetPath) {
            try { await fs.unlink(targetPath); } catch {}
          }
          results.push({ id: updated.id, version: updated.version, path: dstFile });
        } catch (e: any) {
          results.push({ id: it.selector.id, version: it.selector.version, path: it.selector.path, error: e?.message || String(e) });
        }
      }
      const allOk = results.every((r) => !r.error);
      if (results.some((r) => r.path && !r.error) && ctx.triggerPromptsReindex) {
        void ctx.triggerPromptsReindex(prj);
      }
      return allOk ? ok({ project: prj, results }) : err('some items failed; see results');
    }
  );

  ctx.server.registerTool(
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
          if (!dryRun) await fs.unlink(targetPath);
          results.push({ id: sel.id, version: sel.version, path: targetPath, deleted: dryRun ? false : true });
        } catch (e: any) {
          results.push({ id: sel.id, version: sel.version, path: sel.path, error: e?.message || String(e) });
        }
      }
      const allOk = results.every((r) => !r.error);
      if (!dryRun && results.some((r) => r.deleted && !r.error) && ctx.triggerPromptsReindex) {
        void ctx.triggerPromptsReindex(prj);
      }
      return allOk ? ok({ project: prj, results, dryRun: !!dryRun }) : err('some items failed; see results');
    }
  );

  ctx.server.registerTool(
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
        signals: z.object({ thumb: z.enum(["up", "down"]).optional(), copied: z.boolean().optional(), abandoned: z.boolean().optional() }).optional(),
        meta: z.record(z.any()).optional(),
      },
    },
    async (params: any) => {
      const prj = resolveProject(params?.project);
      const file = path.join(PROMPTS_DIR, prj, 'experiments', 'feedback.jsonl');
      const ts = new Date().toISOString();
      const event = { ts, project: prj, promptId: params.promptId, version: params.version, variant: params.variant ?? null, sessionId: params.sessionId, userId: params.userId, inputText: params.inputText, modelOutput: params.modelOutput, userMessage: params.userMessage, userEdits: params.userEdits, signals: params.signals || {}, meta: params.meta || {} };
      const appended = await appendJsonl(file, [event]);
      return ok({ path: file, appended });
    }
  );

  ctx.server.registerTool(
    "prompts_ab_report",
    {
      title: "Prompts A/B Report",
      description: "Aggregate A/B metrics and passive feedback for all prompt keys",
      inputSchema: { project: z.string().optional(), writeToDisk: z.boolean().optional() },
    },
    async ({ project, writeToDisk }: { project?: string; writeToDisk?: boolean }) => {
      const prj = resolveProject(project);
      const catalog = await readPromptsCatalog(prj);
      const keys: string[] = Object.keys(catalog?.items || {});
      const byPrompt: Record<string, any> = {};
      for (const k of keys) {
        try {
          const aggr = await readExperiment(prj, k);
          if (!aggr) continue;
          const rows = Object.entries(aggr).map(([variantId, s]: any) => ({
            variantId, trials: s.trials, successRate: s.trials > 0 ? s.successes / s.trials : 0,
            avgScore: s.trials > 0 ? s.scoreSum / s.trials : 0, avgLatencyMs: s.trials > 0 ? s.latencySumMs / s.trials : 0,
            avgCost: s.trials > 0 ? s.costSum / s.trials : 0, avgTokensIn: s.trials > 0 ? s.tokensInSum / s.trials : 0,
            avgTokensOut: s.trials > 0 ? s.tokensOutSum / s.trials : 0
          }));
          byPrompt[k] = { variants: rows };
        } catch {}
      }
      const feedbackPath = path.join(PROMPTS_DIR, prj, 'experiments', 'feedback.jsonl');
      const feedback = await readJsonl(feedbackPath);
      let thumbsUp = 0, thumbsDown = 0, copied = 0, abandoned = 0, editChars = 0, editCount = 0;
      for (const e of feedback) {
        const sig = e?.signals || {};
        if (sig.thumb === 'up') thumbsUp++; else if (sig.thumb === 'down') thumbsDown++;
        if (sig.copied) copied++; if (sig.abandoned) abandoned++;
        if (typeof e?.userEdits === 'string' && e.userEdits.length > 0) { editChars += e.userEdits.length; editCount += 1; }
      }
      const totalThumbs = thumbsUp + thumbsDown;
      const outReport = {
        generatedAt: new Date().toISOString(), project: prj, totalExperiments: keys.length, totalFeedbackEvents: feedback.length, byPrompt,
        feedback: { thumbs: { up: thumbsUp, down: thumbsDown, acceptance: totalThumbs > 0 ? thumbsUp / totalThumbs : 0 }, copiedRate: feedback.length > 0 ? copied / feedback.length : 0, abandonedRate: feedback.length > 0 ? abandoned / feedback.length : 0, avgEditChars: editCount > 0 ? editChars / editCount : 0, editRate: feedback.length > 0 ? editCount / feedback.length : 0 }
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

  ctx.server.registerTool(
    "prompts_list",
    {
      title: "Prompts List",
      description: "List prompts from prompts catalog with optional filters",
      inputSchema: { project: z.string().optional(), latest: z.boolean().optional(), kind: z.string().optional(), status: z.string().optional(), domain: z.string().optional(), tag: z.array(z.string()).optional() },
    },
    async ({ project, latest, kind, status, domain, tag }: { project?: string; latest?: boolean; kind?: string; status?: string; domain?: string; tag?: string[] }) => {
      const prj = resolveProject(project);
      const catalog = await readPromptsCatalog(prj);
      const items: any[] = [];
      const tagSet = tag && tag.length ? new Set(tag) : undefined;
      for (const [key, meta] of Object.entries<any>(catalog?.items || {})) {
        const rec = { id: key, version: meta.version || meta.buildVersion || 'latest', kind: meta.kind || meta.type || 'prompt', status: meta.status || undefined, domain: meta.domain || undefined, tags: Array.isArray(meta.tags) ? meta.tags : [], file: meta.path || undefined };
        if (kind && rec.kind !== kind) continue;
        if (status && rec.status !== status) continue;
        if (domain && rec.domain !== domain) continue;
        if (tagSet && !(rec.tags || []).some((t: string) => tagSet.has(t))) continue;
        items.push(rec);
      }
      return ok({ generatedAt: new Date().toISOString(), total: items.length, items });
    }
  );

  ctx.server.registerTool(
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
          const isOk = typeof obj?.promptId === 'string' && typeof obj?.version === 'string';
          if (isOk) valid++; else { invalid++; samples.push({ line: i + 1, error: 'missing promptId/version' }); }
        } catch (e: any) { invalid++; samples.push({ line: i + 1, error: e?.message || 'parse error' }); }
      });
      if (strict) samples.splice(20);
      return ok({ path: file, total: lines.length, valid, invalid, samples });
    }
  );

  ctx.server.registerTool(
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
          try { const st = await fs.stat(f); files.push({ path: f, size: st.size }); } catch {}
        }
      }
      return ok({ baseDir: base, files });
    }
  );

  ctx.server.registerTool(
    "prompts_search",
    {
      title: "Prompts Search (hybrid)",
      description: "Semantic/lexical search across prompt builds and markdown",
      inputSchema: { project: z.string().optional(), query: z.string().min(1), limit: z.number().int().min(1).max(100).optional(), tags: z.array(z.string()).optional(), kinds: z.array(z.string()).optional() },
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
      const va = await ctx.ensureVectorAdapter();
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

  ctx.server.registerTool(
    "prompts_variants_list",
    { title: "Prompts Variants List", description: "List available variants for a promptKey (experiment or builds)", inputSchema: { project: z.string().optional(), promptKey: z.string().min(1) } },
    async ({ project, promptKey }: { project?: string; promptKey: string }) => {
      const exp = await readExperiment(project, promptKey);
      const fromExp = exp?.variants || [];
      const fromBuilds = await listBuildVariants(project, promptKey);
      const variants = Array.from(new Set([...(fromExp || []), ...fromBuilds]));
      return ok({ promptKey, variants });
    }
  );

  ctx.server.registerTool(
    "prompts_variants_stats",
    { title: "Prompts Variants Stats", description: "Return aggregate metrics per variant for given promptKey", inputSchema: { project: z.string().optional(), promptKey: z.string().min(1) } },
    async ({ project, promptKey }: { project?: string; promptKey: string }) => {
      const aggr = await readAggregates(project, promptKey);
      const rows = Object.entries(aggr).map(([variantId, s]) => ({
        variantId, trials: s.trials, successRate: s.trials > 0 ? s.successes / s.trials : 0,
        avgScore: s.trials > 0 ? s.scoreSum / s.trials : 0, avgLatencyMs: s.trials > 0 ? s.latencySumMs / s.trials : 0,
        avgCost: s.trials > 0 ? s.costSum / s.trials : 0, avgTokensIn: s.trials > 0 ? s.tokensInSum / s.trials : 0,
        avgTokensOut: s.trials > 0 ? s.tokensOutSum / s.trials : 0
      }));
      return ok({ promptKey, stats: rows });
    }
  );

  ctx.server.registerTool(
    "prompts_bandit_next",
    {
      title: "Prompts Bandit Next",
      description: "Pick next variant for a prompt using epsilon-greedy over aggregates",
      inputSchema: { project: z.string().optional(), promptKey: z.string().min(1), epsilon: z.number().min(0).max(1).optional(), contextTags: z.array(z.string()).optional() },
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

  ctx.server.registerTool(
    "prompts_metrics_log_bulk",
    {
      title: "Prompts Metrics Log (Bulk)",
      description: "Append events and update aggregates for prompts (bulk)",
      inputSchema: {
        project: z.string().optional(), promptKey: z.string().min(1),
        items: z.array(z.object({
          ts: z.string().optional(), requestId: z.string().min(1), userId: z.string().optional(), model: z.string().optional(), variantId: z.string().min(1),
          outcome: z.object({ success: z.boolean().optional(), score: z.number().optional(), tokensIn: z.number().optional(), tokensOut: z.number().optional(), latencyMs: z.number().optional(), cost: z.number().optional(), error: z.string().optional() }),
          contextTags: z.array(z.string()).optional()
        })).min(1).max(200),
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

  ctx.server.registerTool(
    "prompts_experiments_upsert",
    {
      title: "Prompts Experiments Upsert",
      description: "Create or update experiment manifest with variants to drive variants_list and bandit",
      inputSchema: { project: z.string().optional(), promptKey: z.string().min(1), variants: z.array(z.string().min(1)).min(1), params: z.record(z.any()).optional() },
    },
    async ({ project, promptKey, variants, params }: { project?: string; promptKey: string; variants: string[]; params?: any }) => {
      const prj = resolveProject(project);
      const file = path.join(PROMPTS_DIR, prj, 'metrics', 'experiments', `${promptKey}.json`);
      const payload = { variants: Array.from(new Set((variants || []).filter((v) => typeof v === 'string' && v.trim().length > 0))), params: params || {} };
      if (payload.variants.length === 0) return err('variants must contain at least one non-empty string');
      try {
        await ensureDirForFile(file);
        await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
        return ok({ project: prj, promptKey, path: file, variants: payload.variants });
      } catch (e: any) { return err(e?.message || String(e)); }
    }
  );
}