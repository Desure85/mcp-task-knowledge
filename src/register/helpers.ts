import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { PROMPTS_DIR, resolveProject } from '../config.js';
import { ok, err } from '../utils/respond.js';
import { reindexPrompts } from '../services/prompts-pipeline.js';
import { childLogger } from '../core/logger.js';

const helpersLog = childLogger('helpers');

export function registerHelpers(ctx: ServerContext) {
  // In-process reindex — previously spawned `node scripts/prompts.mjs`, which
  // silently no-op'ed in npm installs (scripts/ is not in package files).
  ctx.triggerPromptsReindex = async (project: string): Promise<void> => {
    try {
      const res = await reindexPrompts({ baseDir: PROMPTS_DIR, project, projectRoot: ctx.REPO_ROOT });
      if (res.errors.length) {
        helpersLog.warn({ project, errors: res.errors }, 'prompts reindex finished with stage errors');
      }
    } catch (e) {
      helpersLog.warn({ project, err: e }, 'prompts reindex failed');
    }
  };

  ctx.server.registerTool(
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
}

export async function readPromptsCatalog(project?: string): Promise<any | null> {
  const prj = resolveProject(project);
  const file = path.join(PROMPTS_DIR, prj, 'exports', 'catalog', 'prompts.catalog.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function readPromptBuildItems(project?: string): Promise<Array<{ id: string; text: string; item: any }>> {
  const prj = resolveProject(project);
  const buildsDir = path.join(PROMPTS_DIR, prj, 'exports', 'builds');
  const mdDir = buildsDir;
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

export async function ensureDirForFile(filePath: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } catch {}
}

export async function appendJsonl(filePath: string, items: any[]): Promise<number> {
  await ensureDirForFile(filePath);
  const lines = items.map((x) => JSON.stringify(x)).join('\n') + '\n';
  await fs.appendFile(filePath, lines, 'utf8');
  return items.length;
}

export async function readJsonl(filePath: string): Promise<any[]> {
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

export async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries: Dirent[];
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

export async function listSourceJsonFiles(project: string): Promise<string[]> {
  const base = path.join(PROMPTS_DIR, project);
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

export async function findFileByIdVersion(project: string, id: string, version: string): Promise<string | null> {
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