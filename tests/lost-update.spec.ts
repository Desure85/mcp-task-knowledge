/**
 * tests/lost-update.spec.ts — AUD-18c: concurrent read-modify-write on the
 * same task/doc must not drop a writer's change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-lost-update');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');

beforeAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
});
afterAll(async () => { await fsp.rm(TMP_DIR, { recursive: true, force: true }); });

describe('AUD-18c lost updates', () => {
  it('concurrent updateTask patches on disjoint fields all survive', async () => {
    const t = await tasks.createTask({ project: 'p', title: 'orig', description: 'd0', priority: 'low' } as never);
    await Promise.all([
      tasks.updateTask('p', t.id, { title: 'new-title' }),
      tasks.updateTask('p', t.id, { priority: 'high' }),
      tasks.updateTask('p', t.id, { description: 'new-desc' }),
      tasks.updateTask('p', t.id, { tags: ['x'] }),
    ]);
    const got = await tasks.getTask('p', t.id);
    expect(got).toMatchObject({ title: 'new-title', priority: 'high', description: 'new-desc', tags: ['x'] });
  });

  it('20 concurrent updates to one task never corrupt the file', async () => {
    const t = await tasks.createTask({ project: 'p', title: 'many' } as never);
    await Promise.all(Array.from({ length: 20 }, (_, i) => tasks.updateTask('p', t.id, { description: `v${i}` })));
    const got = await tasks.getTask('p', t.id);
    expect(got?.description).toMatch(/^v\d+$/);
  });

  it('concurrent knowledge updates on disjoint fields all survive', async () => {
    const d = await knowledge.createDoc({ project: 'p', title: 'doc', content: 'c0', tags: [] } as never);
    await Promise.all([
      knowledge.updateDoc('p', d.id, { title: 'T2' } as never),
      knowledge.updateDoc('p', d.id, { content: 'c2' } as never),
      knowledge.updateDoc('p', d.id, { tags: ['k'] } as never),
    ]);
    const got = await knowledge.readDoc('p', d.id);
    expect(got).toMatchObject({ title: 'T2', content: 'c2', tags: ['k'] });
  });
});
