import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { PROMPTS_DIR } from '../config.js';

export interface BuildOptions {
  ids?: string[]; // filter which workflow ids to build
  includeKinds?: string[]; // allowed kinds for referenced parts (default: any with template)
  excludeKinds?: string[]; // exclude kinds
  includeTags?: string[]; // filter by tags present on referenced items
  excludeTags?: string[]; // exclude by tags
  latest?: boolean; // pick latest version for refs
  dryRun?: boolean; // plan only
  force?: boolean; // reserved for future invalidation logic
  separator?: string; // global section separator (can be overridden per-step in future)
}

interface IndexRec {
  id: string;
  versions: string[];
  latest: string | null;
  files: Array<{ version: string; path: string; errors?: string[] }>;
  kind?: string | null;
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

async function loadJson(file: string): Promise<any> {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function indexPrompts(files: string[], projectRoot: string): Promise<{ items: Record<string, IndexRec> }> {
  const items: Record<string, IndexRec> = {};
  for (const file of files) {
    let data: any = null;
    try { data = await loadJson(file); } catch { continue; }
    const id = String(data?.id || path.basename(file, '.json'));
    const version = String(data?.version || '0.0.0');
    if (!items[id]) items[id] = { id, versions: [], latest: null, files: [], kind: data?.metadata?.kind || null };
    items[id].versions.push(version);
    items[id].files.push({ version, path: path.relative(projectRoot, file) });
  }
  for (const rec of Object.values(items)) {
    rec.versions.sort(cmpSemver);
    rec.latest = rec.versions[rec.versions.length - 1] || null;
  }
  return { items };
}

export async function buildWorkflows(project: string, opts: BuildOptions = {}): Promise<{ built: number; outputs: Array<{ id: string; md?: string; json?: string }>; skipped: string[] }> {
  const prj = project;
  const base = path.join(PROMPTS_DIR, prj);
  const exportsDir = path.join(base, 'exports', 'builds');
  const projectRoot = path.resolve(path.join(PROMPTS_DIR, prj));
  const SEP = typeof opts.separator === 'string' ? opts.separator : '---';
  const includeTagSet = opts.includeTags && opts.includeTags.length ? new Set(opts.includeTags) : undefined;
  const excludeTagSet = opts.excludeTags && opts.excludeTags.length ? new Set(opts.excludeTags) : undefined;

  // Read all source files and build minimal index
  const files = await listSourceJsonFiles(prj);
  const idx = await indexPrompts(files, projectRoot);
  const byId = new Map<string, IndexRec>(Object.entries(idx.items));

  // Collect candidates: workflow kind
  const candidateFiles: string[] = [];
  for (const f of files) {
    try {
      const data = await loadJson(f);
      if ((data?.metadata?.kind || 'prompt') === 'workflow') {
        if (!opts.ids || opts.ids.length === 0 || opts.ids.includes(String(data.id))) {
          candidateFiles.push(f);
        }
      }
    } catch {}
  }

  const outputs: Array<{ id: string; md?: string; json?: string }> = [];
  const skipped: string[] = [];
  let built = 0;

  for (const wfFile of candidateFiles) {
    let data: any = null;
    try { data = await loadJson(wfFile); } catch { skipped.push(path.basename(wfFile)); continue; }
    const steps: any[] = Array.isArray(data.compose) ? data.compose : [];
    const parts: string[] = [];

    // Optional global pre/post sections on workflow
    const workflowPre = typeof data?.pre === 'string' ? data.pre : '';
    const workflowPost = typeof data?.post === 'string' ? data.post : '';
    if (workflowPre && workflowPre.trim().length) parts.push(String(workflowPre));

    for (const step of steps) {
      const ref: string | undefined = step?.ref;
      if (!ref) continue;
      // Basic version pin support: id@ver
      let refId = ref;
      let pinVer: string | null = null;
      const at = ref.indexOf('@');
      if (at > 0) { refId = ref.slice(0, at); pinVer = ref.slice(at + 1); }

      const rec = byId.get(refId);
      if (!rec) continue;
      const kind = (rec.kind || 'prompt').toLowerCase();
      if (opts.includeKinds && opts.includeKinds.length && !opts.includeKinds.includes(kind)) continue;
      if (opts.excludeKinds && opts.excludeKinds.includes(kind)) continue;

      const version = pinVer || rec.latest || (rec.versions[rec.versions.length - 1] || null);
      if (!version) continue;
      const fileEntry = rec.files.find((f) => f.version === version) || rec.files[rec.files.length - 1];
      if (!fileEntry) continue;

      try {
        const refData = await loadJson(path.join(projectRoot, fileEntry.path));
        if (typeof refData?.template !== 'string') continue;
        // Tag filters
        const refTags: string[] = Array.from(new Set([...
          (Array.isArray(refData?.metadata?.tags) ? refData.metadata.tags : []),
          ...(Array.isArray(refData?.tags) ? refData.tags : []),
        ]));
        if (includeTagSet && !refTags.some((t) => includeTagSet.has(String(t)))) continue;
        if (excludeTagSet && refTags.some((t) => excludeTagSet.has(String(t)))) continue;
        const title = String(step?.title || refData?.metadata?.title || refData?.id || '');
        const level = Math.min(3, Math.max(1, Number(step?.level) || 1));
        const prefix = typeof step?.prefix === 'string' ? step.prefix : '';
        const suffix = typeof step?.suffix === 'string' ? step.suffix : '';
        const sep = typeof step?.separator === 'string' ? step.separator : SEP;
        const heading = `${'#'.repeat(level)} ${title}`.trim();
        const chunk = [
          prefix ? String(prefix) : '',
          heading,
          '',
          refData.template,
          suffix ? String(suffix) : '',
        ].filter((x) => String(x).length > 0).join('\n');
        parts.push(chunk);
        // Add per-step separator except for last will be added by join below
        parts.push(sep);
      } catch {}
    }

    // Remove trailing separator if any
    while (parts.length && (parts[parts.length - 1] === SEP)) parts.pop();

    if (workflowPost && workflowPost.trim().length) parts.push(String(workflowPost));

    const combinedMd = parts.join('\n\n');
    const baseName = path.basename(wfFile, '.json');
    const outMd = path.join(exportsDir, `${baseName}.md`);
    const outJson = path.join(exportsDir, `${baseName}.json`);
    const builtObj = {
      type: 'prompt',
      id: `${data.id}::build`,
      version: data.version || '1.0.0',
      metadata: { ...(data.metadata || {}), kind: 'build' },
      template: combinedMd,
      variables: Array.isArray(data.variables) ? data.variables : [],
    };

    if (!opts.dryRun) {
      await fs.mkdir(path.dirname(outMd), { recursive: true });
      await fs.writeFile(outMd, combinedMd, 'utf8');
      await fs.writeFile(outJson, JSON.stringify(builtObj, null, 2) + '\n', 'utf8');
    }
    outputs.push({ id: String(data.id), md: opts.dryRun ? undefined : outMd, json: opts.dryRun ? undefined : outJson });
    built++;
  }

  return { built, outputs, skipped };
}
