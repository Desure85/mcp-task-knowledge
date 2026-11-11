import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-bulk-per-item');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

type Handler = (args: Record<string, unknown>) => Promise<{ ok: boolean; data?: any; error?: any }>;

let knowledge: typeof import('../src/storage/knowledge.js');
let tools: Map<string, Handler>;

beforeAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  knowledge = await import('../src/storage/knowledge.js');
  const { registerBulkTools } = await import('../src/register/bulk.js');
  tools = new Map();
  const ctx = {
    server: {
      registerTool: (name: string, _def: unknown, handler: Handler) => tools.set(name, handler),
    },
  };
  registerBulkTools(ctx as any);
});

afterAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

async function call(handler: Handler, args: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: any }> {
  const result = await handler(args);
  const text = (result as any).content?.[0]?.text;
  return text ? JSON.parse(text) : (result as any);
}

describe('TR-37 bulk tools isolate per-item failures', () => {
  it('knowledge_bulk_update reports a missing id and keeps successful updates', async () => {
    const project = 'mcp';
    const doc = await knowledge.createDoc({ project, title: 'Bulk doc', content: 'before' });
    const handler = tools.get('knowledge_bulk_update')!;
    const env = await call(handler, { project, items: [{ id: doc.id, title: 'Bulk doc updated' }, { id: 'missing' }] });

    expect(env.ok).toBe(true);
    expect(env.data.count).toBe(1);
    expect(env.data.results).toHaveLength(1);
    expect(env.data.failed).toHaveLength(1);
    expect(env.data.failed[0].id).toBe('missing');
    expect(env.data.failed[0].error.message).toContain('Doc not found');
    expect((await knowledge.readDoc(project, doc.id))?.title).toBe('Bulk doc updated');
  });

  it('knowledge_bulk_archive reports missing ids instead of silently dropping them', async () => {
    const project = 'mcp';
    const doc = await knowledge.createDoc({ project, title: 'Archive doc', content: 'x' });
    const env = await call(tools.get('knowledge_bulk_archive')!, { project, ids: [doc.id, 'nope'] });

    expect(env.ok).toBe(true);
    expect(env.data.count).toBe(1);
    expect(env.data.failed).toEqual([
      expect.objectContaining({ id: 'nope', error: expect.objectContaining({ message: expect.stringContaining('Doc not found') }) }),
    ]);
  });

  it('runBulkResults isolates a thrown item and continues', async () => {
    const { runBulkResults } = await import('../src/bulk.js');
    const results = await runBulkResults(['ok', 'boom', 'null'], async (id) => {
      if (id === 'boom') throw new Error('exploded');
      return id === 'null' ? null : { id };
    }, 'Missing:');

    expect(results).toHaveLength(3);
    expect(results.find((item) => item.id === 'ok')?.ok).toBe(true);
    expect(results.find((item) => item.id === 'boom')?.ok).toBe(false);
    expect(results.find((item) => item.id === 'null')?.error?.message).toContain('Missing:');
  });
});
