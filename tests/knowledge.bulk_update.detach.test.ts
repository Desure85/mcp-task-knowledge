import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-bulk-update-detach');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic imports after env
import type * as KnowledgeNS from '../src/storage/knowledge.js';
import type * as BulkNS from '../src/bulk.js';
let knowledge!: typeof KnowledgeNS;
let bulk!: typeof BulkNS;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
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

/**
 * Bulk detachment scenario via knowledgeBulkUpdate:
 * Create A (parent) and B (child under A). Then knowledgeBulkUpdate with {id:B, parentId:null} and verify:
 * - Envelope ok, count == 1
 * - Returned B has parentId === null
 * - Tree semantics: B considered root-level (falsy parentId)
 */
describe('knowledge_bulk_update detaches to root with parentId:null', () => {
  it('detaches child to root and reflects in tree semantics', async () => {
    const project = 'mcp';
    const A = await knowledge.createDoc({ project, title: 'A', content: 'a' });
    const B = await knowledge.createDoc({ project, title: 'B', content: 'b', parentId: A.id });

    const env = await bulk.knowledgeBulkUpdate(project, [{ id: B.id, parentId: null }]);
    expect(env.ok).toBe(true);
    expect(env.data.count).toBe(1);
    expect(env.data.results).toHaveLength(1);

    const res = env.data.results[0];
    expect(res.id).toBe(B.id);
    expect(res.ok).toBe(true);
    expect((res as any).data?.parentId).toBeNull();

    // Verify persisted state
    const b2 = await knowledge.readDoc(project, B.id);
    expect(b2).toBeTruthy();
    expect(b2!.parentId).toBeNull();

    // Verify tree root placement
    const metas = await knowledge.listDocs({ project });
    const byId = new Map(metas.map((m) => [m.id, { ...m, children: [] as any[] }]));
    const roots: any[] = [];
    for (const m of byId.values()) {
      if (m.parentId && byId.has(m.parentId as string)) {
        byId.get(m.parentId as string)!.children.push(m);
      } else {
        roots.push(m);
      }
    }
    const isRootNow = roots.some((r) => r.id === B.id);
    expect(isRootNow).toBe(true);
  });
});
