/**
 * Y-02c — prompt files behind the storage contract.
 *
 * Prompts live in `PROMPTS_DIR/<project>/{prompts,rules,workflows,templates,policies}/<id>@<version>.json`
 * (sources) with generated artifacts under `exports/`. These functions used to sit in
 * `src/register/helpers.ts`; moving them here takes file access out of a registrar module — which
 * is what Y-02 is for — without changing any path or format. `src/register/helpers.ts` re-exports
 * them so existing call sites keep working, and the file profile (`storage/profiles/file`) uses
 * them as the implementation of `PromptStore`.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { PROMPTS_DIR, resolveProject } from '../config.js';
import { resolveUnder } from '../fs.js';

/** Prompt kinds with their own source directory (mirrors `src/prompts/build.ts`). */
export const PROMPT_KIND_DIRS = ['prompts', 'rules', 'workflows', 'templates', 'policies'] as const;

/** The generated catalog of built prompts, if the pipeline produced one. */
export async function readPromptsCatalog(project?: string): Promise<any | null> {
  const prj = resolveProject(project);
  const file = resolveUnder(PROMPTS_DIR, prj, 'exports', 'catalog', 'prompts.catalog.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Built prompt artifacts (JSON + markdown) prepared for search. */
export async function readPromptBuildItems(project?: string): Promise<Array<{ id: string; text: string; item: any }>> {
  const prj = resolveProject(project);
  const buildsDir = resolveUnder(PROMPTS_DIR, prj, 'exports', 'builds');
  const mdDir = buildsDir;
  const out: Array<{ id: string; text: string; item: any }> = [];
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(buildsDir, { withFileTypes: true });
  } catch {}
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

/** All source JSON files of a project's prompts (one file per id+version). */
export async function listSourceJsonFiles(project: string): Promise<string[]> {
  const base = resolveUnder(PROMPTS_DIR, project);
  const dirs = PROMPT_KIND_DIRS.map((d) => path.join(base, d));
  const out: string[] = [];
  for (const d of dirs) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      out.push(path.join(d, e.name));
    }
  }
  return out;
}

export interface PromptVersionInfo {
  version: string;
  path: string;
  latest: boolean;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return a.localeCompare(b);
}

/** All source versions of a prompt id, oldest first. */
export async function listPromptVersions(project: string, id: string): Promise<PromptVersionInfo[]> {
  const files = await listSourceJsonFiles(project);
  const versions: Array<{ version: string; path: string }> = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const data = JSON.parse(raw);
      if (data?.id === id && typeof data?.version === 'string' && data.version.length > 0) {
        if (!versions.some((v) => v.version === data.version)) {
          versions.push({ version: data.version, path: file });
        }
      }
    } catch {
      // Skip malformed files; prompts_get reports not found or reads the selected one.
    }
  }
  versions.sort((a, b) => cmpSemver(a.version, b.version));
  return versions.map((v, index) => ({ ...v, latest: index === versions.length - 1 }));
}

/** Path of the source file for one id+version, if it exists. */
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
