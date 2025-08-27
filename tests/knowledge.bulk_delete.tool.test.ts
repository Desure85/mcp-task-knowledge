import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-bulk-delete-tool');
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

describe('knowledge_bulk_delete helpers: confirm/dryRun', () => {
  it('confirm=false -> ошибка подтверждения без изменений', async () => {
    const project = 'mcp';
    const a = await knowledge.createDoc({ project, title: 'A', content: 'a' });
    const b = await knowledge.createDoc({ project, title: 'B', content: 'b' });

    const res = await helpers.handleKnowledgeBulkDelete({ project, ids: [a.id, b.id], confirm: false });
    expect((res as any).ok).toBe(false);
    expect((res as any).error?.message).toContain('not confirmed');

    const ar = await knowledge.readDoc(project, a.id);
    const br = await knowledge.readDoc(project, b.id);
    expect(ar).not.toBeNull();
    expect(br).not.toBeNull();
  });

  it('dryRun=true -> ok, возвращает метаданные для существующих и ошибки для отсутствующих, без удаления', async () => {
    const project = 'mcp';
    const a = await knowledge.createDoc({ project, title: 'A2', content: 'a2' });
    const missing = 'ghost-id';

    const res = await helpers.handleKnowledgeBulkDelete({ project, ids: [a.id, missing], dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.data.count).toBe(2);
    const rA = res.data.results.find(r => r.id === a.id)!;
    const rG = res.data.results.find(r => r.id === missing)!;
    expect(rA.ok).toBe(true);
    expect(rA.data?.id).toBe(a.id);
    expect(rG.ok).toBe(false);
    expect(rG.error?.message).toContain('Doc not found');

    const after = await knowledge.readDoc(project, a.id);
    expect(after).not.toBeNull();
  });
});
