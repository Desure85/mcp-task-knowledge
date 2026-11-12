/** Z-07 register: prompts_merge_prepare / prompts_merge_apply. */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v3';
import { DATA_DIR } from '../config.js';
import { mergePromptVersions } from '../prompts/merge.js';
import { ok, err } from '../utils/respond.js';
import type { ServerContext } from './context.js';

const DRAFT_DIR = path.join(DATA_DIR, '.prompt-merge-drafts');

async function readDraft(id: string): Promise<Record<string, unknown> | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  try { return JSON.parse(await fs.readFile(path.join(DRAFT_DIR, `${id}.json`), 'utf8')); } catch { return null; }
}

export function registerPromptMergeTools(ctx: ServerContext): void {
  ctx.server.registerTool('prompts_merge_prepare', {
    title: 'Prepare Prompt Merge',
    description: 'Three-way merge of base/local/remote prompt text; validates variables, !commands and allowed-tools. Returns a draft id; conflicts require confirmation on apply.',
    inputSchema: { base: z.string(), local: z.string(), remote: z.string() },
  }, async ({ base, local, remote }: { base: string; local: string; remote: string }) => {
    const result = mergePromptVersions({ base, local, remote });
    const id = randomUUID();
    await fs.mkdir(DRAFT_DIR, { recursive: true });
    await fs.writeFile(path.join(DRAFT_DIR, `${id}.json`), JSON.stringify({ id, ...result, createdAt: new Date().toISOString() }), 'utf8');
    return ok({ draftId: id, ...result });
  });

  ctx.server.registerTool('prompts_merge_apply', {
    title: 'Apply Prompt Merge',
    description: 'Apply a prepared merge draft to targetPath (relative to DATA_DIR). Conflicts require confirm=true.',
    inputSchema: { draftId: z.string(), targetPath: z.string().min(1), confirm: z.boolean().optional() },
  }, async ({ draftId, targetPath, confirm }: { draftId: string; targetPath: string; confirm?: boolean }) => {
    const draft = await readDraft(draftId);
    if (!draft) return err('merge draft not found');
    if (draft.status === 'conflict' && confirm !== true) return err('merge has conflicts; require confirm=true');
    const abs = path.resolve(DATA_DIR, targetPath);
    if (!abs.startsWith(path.resolve(DATA_DIR) + path.sep)) return err('targetPath must stay inside DATA_DIR');
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(draft.merged), 'utf8');
    return ok({ draftId, targetPath, status: draft.status, applied: true });
  });
}
