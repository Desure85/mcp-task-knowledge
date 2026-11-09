import path from 'node:path';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { PROMPTS_DIR, resolveProject } from '../config.js';
import { ok, err } from '../utils/respond.js';
import { reindexPrompts } from '../services/prompts-pipeline.js';
import { childLogger } from '../core/logger.js';
import { readPromptsCatalog } from '../prompts/files.js';

const helpersLog = childLogger('helpers');

// Y-02c: prompt file access moved to `src/prompts/files.ts` so the storage profile can own it.
// Re-exported here because the prompt tools import these helpers from this module.
export {
  findFileByIdVersion,
  listPromptVersions,
  listSourceJsonFiles,
  readPromptBuildItems,
  readPromptsCatalog,
  type PromptVersionInfo,
} from '../prompts/files.js';

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
