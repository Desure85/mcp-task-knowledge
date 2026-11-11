import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP = path.join(process.cwd(), '.tmp-tests-graph-neighbors');
process.env.DATA_DIR = TMP;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');
let graphTools: typeof import('../src/register/graph-neighbors.js');
let TemporalGraph: typeof import('../src/memory/temporal-graph.js').TemporalGraph;
let handler: Handler;

function parse(result: unknown) {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text ?? '{}') as { ok: boolean; data?: any };
}

beforeAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(path.join(TMP, 'vault'), { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  graphTools = await import('../src/register/graph-neighbors.js');
  ({ TemporalGraph } = await import('../src/memory/temporal-graph.js'));
  graphTools.registerGraphNeighborsTools({
    server: {
      registerTool: (_name: string, _def: unknown, fn: Handler) => {
        handler = fn;
      },
    },
  } as never);
});

afterAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

describe('U-06 graph_neighbors', () => {
  it('returns task dependencies/blocks/parent/children with reasons', async () => {
    const prj = 'neighbors-a';
    const a = await tasks.createTask({ project: prj, title: 'Ship it', priority: 'high' });
    const b = await tasks.createTask({ project: prj, title: 'Blocked by A', priority: 'medium' });
    const c = await tasks.createTask({ project: prj, title: 'Child of B', priority: 'low' });
    await tasks.updateTask(prj, b!.id, { dependsOn: [a!.id] } as never);
    await tasks.updateTask(prj, c!.id, { parentId: b!.id } as never);

    const graph = new TemporalGraph({ storagePath: path.join(TMP, 'memory', 'temporal-graph.json') });
    graph.addFact({ statement: 'Ship it needs a release note.', entities: ['Ship it'], category: 'fact' });

    const result = parse(await handler({ project: prj, id: a!.id }));
    expect(result.ok).toBe(true);
    expect(result.data.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'task', id: b!.id, relation: 'blocks', direction: 'in' }),
      expect.objectContaining({ kind: 'memory', relation: 'mentions', direction: 'in' }),
    ]));
    expect(result.data.neighbors.some((n: any) => n.id === c!.id)).toBe(false);

    const parent = parse(await handler({ project: prj, id: b!.id }));
    expect(parent.data.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'task', id: a!.id, relation: 'depends_on', direction: 'out' }),
      expect.objectContaining({ kind: 'task', id: c!.id, relation: 'child', direction: 'in' }),
    ]));
  });

  it('returns knowledge parent/child and memory entity mentions', async () => {
    const prj = 'neighbors-b';
    const parent = await knowledge.createDoc({ project: prj, title: 'Guide', content: 'root', type: 'component' });
    const child = await knowledge.createDoc({
      project: prj,
      title: 'Guide child',
      content: 'child',
      type: 'api',
      parentId: parent!.id,
    });
    const graph = new TemporalGraph({ storagePath: path.join(TMP, 'memory', 'temporal-graph.json') });
    graph.addFact({ statement: 'TypeScript is preferred.', entities: ['TypeScript'], category: 'preference' });

    const fromParent = parse(await handler({ project: prj, id: parent!.id }));
    expect(fromParent.data.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'knowledge', id: child!.id, relation: 'child', direction: 'in' }),
    ]));

    const fromChild = parse(await handler({ project: prj, id: child!.id }));
    expect(fromChild.data.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'knowledge', id: parent!.id, relation: 'parent', direction: 'out' }),
    ]));

    const entity = parse(await handler({ project: prj, id: 'TypeScript' }));
    expect(entity.data.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'memory', relation: 'mentions', title: 'TypeScript is preferred.' }),
    ]));
  });

  it('honors limit/fields and returns empty for an unknown id', async () => {
    const prj = 'neighbors-c';
    const a = await tasks.createTask({ project: prj, title: 'A', priority: 'low' });
    for (let i = 0; i < 3; i++) {
      const t = await tasks.createTask({ project: prj, title: `B${i}`, priority: 'low' });
      await tasks.updateTask(prj, t!.id, { dependsOn: [a!.id] } as never);
    }

    const limited = parse(await handler({ project: prj, id: a!.id, limit: 2, fields: ['id', 'relation'] }));
    expect(limited.data.total).toBe(3);
    expect(limited.data.count).toBe(2);
    expect(limited.data.neighbors).toHaveLength(2);
    expect(Object.keys(limited.data.neighbors[0]).sort()).toEqual(['id', 'relation']);

    const missing = parse(await handler({ project: prj, id: 'does-not-exist' }));
    expect(missing.ok).toBe(true);
    expect(missing.data.total).toBe(0);
    expect(missing.data.neighbors).toEqual([]);
  });
});
