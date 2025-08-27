import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-bulk');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic imports after env
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as BulkNS from '../src/bulk.js';
let knowledge!: typeof KnowledgeNS;
let bulk!: typeof BulkNS;

async function rmrf(p: string) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  knowledge = await import('../src/storage/knowledge.js');
  bulk = await import('../src/bulk.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('knowledge bulk operations return aggregated per-id results', () => {
  it('archive: ok for existing, error for missing id', async () => {
    const project = 'mcp';
    const d1 = await knowledge.createDoc({ project, title: 'Doc1', content: 'c1' });

    const env = await bulk.knowledgeBulkArchive(project, [d1.id, 'nope']);
    expect(env.ok).toBe(true);
    expect(env.data.count).toBe(2);
    expect(env.data.results).toHaveLength(2);

    const r1 = env.data.results.find(r => r.id === d1.id)!;
    const r2 = env.data.results.find(r => r.id === 'nope')!;
    expect(r1.ok).toBe(true);
    expect(r1.data).toBeTruthy();
    expect(r2.ok).toBe(false);
    expect(r2.error?.message).toContain('Doc not found');

    // Verify archived flag persisted
    const d1r = await knowledge.readDoc(project, d1.id);
    expect(d1r?.archived).toBe(true);
  });

  it('trash and restore: aggregate results and state transitions', async () => {
    const project = 'mcp';
    const a = await knowledge.createDoc({ project, title: 'A', content: 'a' });
    const b = await knowledge.createDoc({ project, title: 'B', content: 'b' });

    const trashEnv = await bulk.knowledgeBulkTrash(project, [a.id, b.id, 'missing']);
    expect(trashEnv.ok).toBe(true);
    expect(trashEnv.data.results.find(r => r.id === a.id)?.ok).toBe(true);
    expect(trashEnv.data.results.find(r => r.id === b.id)?.ok).toBe(true);
    expect(trashEnv.data.results.find(r => r.id === 'missing')?.ok).toBe(false);

    const ar = await knowledge.readDoc(project, a.id);
    const br = await knowledge.readDoc(project, b.id);
    expect(ar?.trashed).toBe(true);
    expect(br?.trashed).toBe(true);

    const restEnv = await bulk.knowledgeBulkRestore(project, [a.id, 'missing']);
    expect(restEnv.ok).toBe(true);
    expect(restEnv.data.results.find(r => r.id === a.id)?.ok).toBe(true);
    expect(restEnv.data.results.find(r => r.id === 'missing')?.ok).toBe(false);

    const ar2 = await knowledge.readDoc(project, a.id);
    expect(ar2?.trashed).toBe(false);
    expect(ar2?.archived).toBe(false);
  });

  it('delete permanent: returns ok for deleted and error for missing', async () => {
    const project = 'mcp';
    const d = await knowledge.createDoc({ project, title: 'ToDelete', content: 'x' });

    const delEnv = await bulk.knowledgeBulkDeletePermanent(project, [d.id, 'ghost']);
    expect(delEnv.ok).toBe(true);
    const okRes = delEnv.data.results.find(r => r.id === d.id)!;
    const badRes = delEnv.data.results.find(r => r.id === 'ghost')!;
    expect(okRes.ok).toBe(true);
    expect(okRes.data).toBe(true); // underlying storage returns boolean
    expect(badRes.ok).toBe(false);
    expect(badRes.error?.message).toContain('Doc not found');

    const after = await knowledge.readDoc(project, d.id);
    expect(after).toBeNull();
  });
});
