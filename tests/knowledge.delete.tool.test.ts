import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-delete-tool');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic imports after env
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as Helpers from '../src/tools/knowledge_delete_helpers.js';
let knowledge!: typeof KnowledgeNS;
let helpers!: typeof Helpers;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  knowledge = await import('../src/storage/knowledge.js');
  helpers = await import('../src/tools/knowledge_delete_helpers.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('knowledge_delete helpers: confirm/dryRun', () => {
  it('confirm=false -> error, без изменений', async () => {
    const project = 'mcp';
    const d = await knowledge.createDoc({ project, title: 'NoDelete', content: 'x' });

    const res = await helpers.handleKnowledgeDelete({ project, id: d.id, confirm: false });
    expect(res.ok).toBe(false);
    expect((res as any).error?.message).toContain('not confirmed');

    const after = await knowledge.readDoc(project, d.id);
    expect(after).not.toBeNull();
  });

  it('dryRun=true -> ok, возвращает метаданные, без удаления', async () => {
    const project = 'mcp';
    const d = await knowledge.createDoc({ project, title: 'DryRun', content: 'y' });

    const res = await helpers.handleKnowledgeDelete({ project, id: d.id, dryRun: true });
    expect(res.ok).toBe(true);
    expect((res as any).data?.id).toBe(d.id);

    const after = await knowledge.readDoc(project, d.id);
    expect(after).not.toBeNull();
  });
});
