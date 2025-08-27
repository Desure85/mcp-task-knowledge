import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-detach');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic imports after env
import type * as KnowledgeNS from '../src/storage/knowledge.js';
let knowledge!: typeof KnowledgeNS;

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
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

/**
 * Detachment scenario for knowledge docs:
 * Create A (parent) and B (child under A). Then update B with parentId:null and verify:
 * - B.parentId becomes null (persisted in frontmatter)
 * - Tree semantics: B is considered a root (falsy parentId is treated as root)
 */
describe('knowledge detachment to root via parentId:null', () => {
  it('updates parentId to null and places doc on top-level', async () => {
    const project = 'mcp';
    // Create parent A and child B
    const A = await knowledge.createDoc({ project, title: 'A', content: 'a' });
    const B = await knowledge.createDoc({ project, title: 'B', content: 'b', parentId: A.id });

    const b1 = await knowledge.readDoc(project, B.id);
    expect(b1).toBeTruthy();
    expect(b1!.parentId).toBe(A.id);

    // Detach: set parentId:null
    const b2 = await knowledge.updateDoc(project, B.id, { parentId: null } as any);
    expect(b2).toBeTruthy();
    // Persistence: for knowledge, null is kept as null (not normalized to undefined)
    expect(b2!.parentId).toBeNull();

    // Verify that listing considers it as a root-level doc (falsy parentId => root)
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

    // B should be among roots after detachment
    const isRootNow = roots.some((r) => r.id === B.id);
    expect(isRootNow).toBe(true);
  });
});
