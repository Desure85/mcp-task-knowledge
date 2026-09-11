// src/services/prompts-pipeline.ts
// In-process port of scripts/prompts.mjs — the same pipeline that the CLI
// runs (index → catalog → catalog:services → export-json → export-md → build),
// but callable from the server itself. scripts/ is NOT shipped in the npm
// package, so the spawn-based reindex silently no-op'ed in production
// installs (found by Q-014 e2e). This module removes that dependency.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveUnder } from '../fs.js';

const ALLOWED_STATUS = new Set(['draft', 'review', 'published', 'deprecated']);
const SOURCE_DIRS = ['prompts', 'rules', 'workflows', 'templates', 'policies'];

export interface PromptsPipelineOptions {
  /** Base dir containing the per-project prompts tree (PROMPTS_DIR). */
  baseDir: string;
  /** Project name (e.g. 'mcp'). */
  project: string;
  /** Root used for relative paths written into index/catalog files. */
  projectRoot: string;
}

export interface ReindexResult {
  indexed: number;
  cataloged: number;
  serviceItems: number;
  exportedJson: number;
  exportedMd: number;
  built: number;
  errors: string[];
}

interface PipelineDirs {
  projectDataDir: string;
  exportsDir: string;
  exportsJsonDir: string;
  exportsMdDir: string;
  exportsCatalogDir: string;
  exportsBuildsDir: string;
  indexFile: string;
  validationReport: string;
}

// ─── Prompt document shapes (loose JSON — validated at runtime) ─────

interface PromptMeta {
  title?: string;
  domain?: string;
  status?: string;
  kind?: string;
  tags?: string[];
}

interface PromptVariable {
  name?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

interface PromptJson {
  id?: string;
  version?: string;
  type?: string;
  template?: string;
  compose?: Array<{ ref?: string }>;
  variables?: PromptVariable[];
  examples?: Array<{ title?: string; id?: string }>;
  metadata?: PromptMeta;
}

interface IndexFileEntry {
  version: string;
  path: string;
  errors: string[];
  metadata: PromptMeta | null;
}

interface IndexItem {
  id: string;
  versions: string[];
  latest: string | null;
  files: IndexFileEntry[];
  kind: string | null;
  status?: string | null;
  domain?: string | null;
  title?: string | null;
  tags?: string[];
}

interface PromptIndex {
  generatedAt: string;
  items: Record<string, IndexItem>;
}

function resolveDirs(baseDir: string, project: string): PipelineDirs {
  const projectDataDir = resolveUnder(baseDir, project);
  const exportsDir = path.join(projectDataDir, 'exports');
  return {
    projectDataDir,
    exportsDir,
    exportsJsonDir: path.join(exportsDir, 'json'),
    exportsMdDir: path.join(exportsDir, 'markdown'),
    exportsCatalogDir: path.join(exportsDir, 'catalog'),
    exportsBuildsDir: path.join(exportsDir, 'builds'),
    indexFile: path.join(projectDataDir, 'index.json'),
    validationReport: path.join(projectDataDir, 'quality', 'validation.json'),
  };
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function minimalValidatePrompt(o: PromptJson | null | undefined): string[] {
  const errs: string[] = [];
  if (!o || typeof o !== 'object') return ['Not an object'];
  if (o.type !== 'prompt') errs.push('type must be "prompt"');
  if (!o.id || typeof o.id !== 'string') errs.push('id required string');
  if (!o.version || typeof o.version !== 'string') errs.push('version required string');
  if (!o.metadata || typeof o.metadata !== 'object') errs.push('metadata required object');
  else {
    if (!o.metadata.title) errs.push('metadata.title required');
    if (!o.metadata.domain) errs.push('metadata.domain required');
    if (!o.metadata.status || !ALLOWED_STATUS.has(o.metadata.status)) {
      errs.push('metadata.status must be one of ' + Array.from(ALLOWED_STATUS).join(','));
    }
    if (o.metadata.kind && typeof o.metadata.kind !== 'string') {
      errs.push('metadata.kind must be string if provided');
    }
  }
  const kind = o?.metadata?.kind || 'prompt';
  if (kind === 'workflow') {
    if (!Array.isArray(o.compose)) errs.push('compose array required for workflow');
  } else {
    if (!o.template || typeof o.template !== 'string') errs.push('template required string');
  }
  if (!Array.isArray(o.variables)) errs.push('variables must be array');
  return errs;
}

async function loadJson(file: string): Promise<unknown> {
  const raw = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const err = new Error(`Invalid JSON in ${file}: ${msg}`);
    (err as Error & { code?: string }).code = 'EJSON';
    throw err;
  }
}

async function writeJson(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function findPromptFiles(dirs: PipelineDirs): Promise<string[]> {
  const files: string[] = [];
  for (const name of SOURCE_DIRS) {
    const dir = path.join(dirs.projectDataDir, name);
    try {
      await fs.access(dir);
    } catch {
      continue;
    }
    for await (const f of walk(dir)) {
      if (f.endsWith('.json')) files.push(f);
    }
  }
  return files.sort();
}

async function ensureDirs(dirs: PipelineDirs): Promise<void> {
  const all = [
    dirs.projectDataDir,
    path.join(dirs.projectDataDir, 'versions'),
    path.join(dirs.projectDataDir, 'experiments'),
    path.join(dirs.projectDataDir, 'quality'),
    ...SOURCE_DIRS.map((d) => path.join(dirs.projectDataDir, d)),
    dirs.exportsDir,
    dirs.exportsJsonDir,
    dirs.exportsMdDir,
    dirs.exportsCatalogDir,
    dirs.exportsBuildsDir,
  ];
  for (const d of all) {
    await fs.mkdir(d, { recursive: true });
  }
}

async function indexPrompts(files: string[], projectRoot: string): Promise<PromptIndex> {
  const index: PromptIndex = { generatedAt: new Date().toISOString(), items: {} };
  for (const file of files) {
    let data: PromptJson | null = null;
    let errs: string[];
    try {
      data = (await loadJson(file)) as PromptJson;
      errs = minimalValidatePrompt(data);
    } catch (e: unknown) {
      errs = [e instanceof Error ? e.message : String(e)];
    }
    const id = data?.id || path.basename(file).replace(/\.json$/, '');
    const ver = data?.version || '0.0.0';
    if (!index.items[id]) index.items[id] = { id, versions: [], latest: null, files: [], kind: data?.metadata?.kind || null };
    index.items[id].versions.push(ver);
    index.items[id].files.push({ version: ver, path: path.relative(projectRoot, file), errors: errs, metadata: data?.metadata || null });
  }
  for (const it of Object.values(index.items)) {
    it.versions.sort(cmpSemver);
    it.latest = it.versions[it.versions.length - 1] || null;
    // Expose the latest version's metadata on the item so catalog consumers
    // (prompts_list status/domain/tag filters) can actually see it.
    const latestFile = it.files.find((f) => f.version === it.latest) || it.files[it.files.length - 1];
    const m = latestFile?.metadata || null;
    if (m) {
      it.status = m.status ?? null;
      it.domain = m.domain ?? null;
      it.title = m.title ?? null;
      it.tags = Array.isArray(m.tags) ? m.tags : [];
    }
  }
  return index;
}

async function exportCatalog(files: string[], dirs: PipelineDirs, projectRoot: string): Promise<{ path: string; count: number }> {
  const idx = await indexPrompts(files, projectRoot);
  const manifest = {
    generatedAt: idx.generatedAt,
    items: Object.fromEntries(
      Object.entries(idx.items).map(([id, rec]) => [
        id,
        {
          id: rec.id,
          kind: rec.kind || null,
          status: rec.status ?? null,
          domain: rec.domain ?? null,
          title: rec.title ?? null,
          tags: Array.isArray(rec.tags) ? rec.tags : [],
          latest: rec.latest,
          versions: rec.versions,
          files: rec.files,
        },
      ])
    ),
  };
  const dest = path.join(dirs.exportsCatalogDir, 'prompts.catalog.json');
  await fs.mkdir(dirs.exportsCatalogDir, { recursive: true });
  await fs.writeFile(dest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { path: dest, count: Object.keys(manifest.items).length };
}

async function exportServiceItems(
  files: string[],
  dirs: PipelineDirs,
  project: string,
  projectRoot: string,
): Promise<{ path: string; count: number }> {
  const items: Array<Record<string, unknown>> = [];
  const nowIso = new Date().toISOString();
  for (const file of files) {
    let data: PromptJson | null;
    try {
      data = (await loadJson(file)) as PromptJson;
    } catch {
      continue;
    }
    const kind = data?.metadata?.kind || 'prompt';
    const id = String(data?.id || '').trim() || path.basename(file, '.json');
    const version = String(data?.version || '').trim() || '0.0.0';
    const title = data?.metadata?.title || id;
    const domain = data?.metadata?.domain || undefined;
    const status = data?.metadata?.status || undefined;
    const tags = Array.isArray(data?.metadata?.tags) ? data.metadata.tags : [];
    let updatedAt = nowIso;
    try {
      const st = await fs.stat(file);
      updatedAt = new Date(st.mtimeMs).toISOString();
    } catch {}
    items.push({
      id: `${id}@${version}`,
      name: title,
      component: 'prompt-library',
      domain,
      status,
      owners: undefined,
      tags: Array.from(new Set([kind, ...tags])),
      annotations: {
        file: path.relative(projectRoot, file),
        promptId: id,
        version,
        kind,
        project,
      },
      updatedAt,
    });
  }
  const dest = path.join(dirs.exportsCatalogDir, 'services.embedded.json');
  await fs.mkdir(dirs.exportsCatalogDir, { recursive: true });
  await fs.writeFile(dest, JSON.stringify({ items }, null, 2) + '\n', 'utf8');
  return { path: dest, count: items.length };
}

function renderMarkdown(prompt: PromptJson): string {
  const md: string[] = [];
  md.push(`# ${prompt.metadata?.title || prompt.id}`);
  md.push('');
  md.push(`- id: ${prompt.id}`);
  md.push(`- version: ${prompt.version}`);
  md.push(`- domain: ${prompt.metadata?.domain || ''}`);
  md.push(`- status: ${prompt.metadata?.status || ''}`);
  const tags = Array.isArray(prompt.metadata?.tags) ? prompt.metadata.tags.join(', ') : '';
  if (tags) md.push(`- tags: ${tags}`);
  md.push('');
  md.push('## Template');
  md.push('');
  md.push('```');
  md.push(prompt.template || '');
  md.push('```');
  if (Array.isArray(prompt.variables) && prompt.variables.length) {
    md.push('');
    md.push('## Variables');
    md.push('');
    for (const v of prompt.variables) {
      md.push(`- ${v.name} (${v.type}) ${v.required ? '[required]' : ''} ${v.default !== undefined ? `default=${JSON.stringify(v.default)}` : ''}`.trim());
    }
  }
  if (Array.isArray(prompt.examples) && prompt.examples.length) {
    md.push('');
    md.push('## Examples');
    md.push('');
    for (const ex of prompt.examples) {
      md.push(`- ${ex.title || ex.id || ''}`);
    }
  }
  md.push('');
  return md.join('\n');
}

async function exportJson(files: string[], dirs: PipelineDirs): Promise<{ count: number }> {
  let count = 0;
  for (const file of files) {
    const dest = path.join(dirs.exportsJsonDir, path.basename(file));
    await fs.copyFile(file, dest);
    count++;
  }
  return { count };
}

async function exportMarkdown(files: string[], dirs: PipelineDirs): Promise<{ count: number }> {
  let count = 0;
  for (const file of files) {
    let data: PromptJson;
    try {
      data = (await loadJson(file)) as PromptJson;
    } catch {
      continue;
    }
    const dest = path.join(dirs.exportsMdDir, `${path.basename(file, '.json')}.md`);
    await fs.writeFile(dest, renderMarkdown(data), 'utf8');
    count++;
  }
  return { count };
}

async function loadIndexOrBuild(files: string[], dirs: PipelineDirs, projectRoot: string): Promise<PromptIndex> {
  try {
    const raw = await fs.readFile(dirs.indexFile, 'utf8');
    return JSON.parse(raw) as PromptIndex;
  } catch {
    return indexPrompts(files, projectRoot);
  }
}

async function buildWorkflows(files: string[], dirs: PipelineDirs, projectRoot: string): Promise<{ built: number }> {
  const idx = await loadIndexOrBuild(files, dirs, projectRoot);
  const byId = new Map<string, IndexItem>();
  for (const [id, rec] of Object.entries(idx.items || {})) {
    byId.set(id, rec);
  }
  let built = 0;
  for (const file of files) {
    let data: PromptJson;
    try {
      data = (await loadJson(file)) as PromptJson;
    } catch {
      continue;
    }
    if (data?.metadata?.kind !== 'workflow') continue;
    const steps = Array.isArray(data.compose) ? data.compose : [];
    const parts: string[] = [];
    for (const step of steps) {
      const refId = step?.ref;
      if (!refId) continue;
      const rec = byId.get(refId);
      if (!rec) continue;
      const latestVer = rec.latest || (rec.versions && rec.versions[rec.versions.length - 1]);
      const fileEntry = rec.files.find((f) => f.version === latestVer) || rec.files[rec.files.length - 1];
      if (!fileEntry) continue;
      try {
        const refData = (await loadJson(path.join(projectRoot, fileEntry.path))) as PromptJson;
        parts.push(`# ${refData.metadata?.title || refData.id}\n\n${refData.template || ''}`);
      } catch {}
    }
    const combinedMd = parts.join('\n\n---\n\n');
    const baseName = path.basename(file, '.json');
    const outMd = path.join(dirs.exportsBuildsDir, `${baseName}.md`);
    const outJson = path.join(dirs.exportsBuildsDir, `${baseName}.json`);
    const builtObj = {
      type: 'prompt',
      id: `${data.id}::build`,
      version: data.version || '1.0.0',
      metadata: { ...(data.metadata || {}), kind: 'build' },
      template: combinedMd,
      variables: data.variables || [],
    };
    await fs.mkdir(path.dirname(outMd), { recursive: true });
    await fs.writeFile(outMd, combinedMd, 'utf8');
    await fs.writeFile(outJson, JSON.stringify(builtObj, null, 2) + '\n', 'utf8');
    built++;
  }
  return { built };
}

/**
 * Full reindex pipeline — equivalent of running scripts/prompts.mjs
 * `index`, `catalog`, `catalog:services`, `export-json`, `export-md`, `build`.
 * Every stage is isolated: a failure in one does not abort the rest.
 */
export async function reindexPrompts(opts: PromptsPipelineOptions): Promise<ReindexResult> {
  const dirs = resolveDirs(opts.baseDir, opts.project);
  const result: ReindexResult = { indexed: 0, cataloged: 0, serviceItems: 0, exportedJson: 0, exportedMd: 0, built: 0, errors: [] };
  const stage = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e: unknown) {
      result.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await ensureDirs(dirs);
  const files = await findPromptFiles(dirs);

  await stage('index', async () => {
    const idx = await indexPrompts(files, opts.projectRoot);
    await writeJson(dirs.indexFile, idx);
    result.indexed = Object.keys(idx.items).length;
  });
  await stage('catalog', async () => {
    result.cataloged = (await exportCatalog(files, dirs, opts.projectRoot)).count;
  });
  await stage('catalog:services', async () => {
    result.serviceItems = (await exportServiceItems(files, dirs, opts.project, opts.projectRoot)).count;
  });
  await stage('export-json', async () => {
    result.exportedJson = (await exportJson(files, dirs)).count;
  });
  await stage('export-md', async () => {
    result.exportedMd = (await exportMarkdown(files, dirs)).count;
  });
  await stage('build', async () => {
    result.built = (await buildWorkflows(files, dirs, opts.projectRoot)).built;
  });

  return result;
}
