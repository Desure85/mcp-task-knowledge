import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP = path.join(process.cwd(), '.tmp-tests-changes-since');
process.env.DATA_DIR = TMP;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
let tools: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');
let changes: typeof import('../src/register/changes.js');
let TemporalGraph: typeof import('../src/memory/temporal-graph.js').TemporalGraph;
let handler: Handler;

function parse(result: unknown) {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text ?? '{}') as { ok: boolean; data?: any; error?: any };
}

beforeAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(path.join(TMP, 'vault'), { recursive: true });
  tools = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  changes = await import('../src/register/changes.js');
  ({ TemporalGraph } = await import('../src/memory/temporal-graph.js'));
  changes.registerChangesTools({
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

describe('U-02 changes_since', () => {
  it('returns task/knowledge/memory deltas with a stable nextSince', async () => {
    const prj = 'changes-a';
    const task = await tools.createTask({ project: prj, title: 'Ship it', priority: 'high' });
    await tools.closeTask(prj, task!.id);
    const doc = await knowledge.createDoc({ project: prj, title: 'Runbook', content: 'v1', type: 'api' });
    await knowledge.updateDoc(prj, doc!.id, { content: 'v2' });
    const graph = new TemporalGraph({ storagePath: path.join(TMP, 'memory', 'temporal-graph.json') });
    graph.addFact({ statement: 'Deploys happen on Fridays.', category: 'fact' });

    const result = parse(await handler({ since: '2000-01-01T00:00:00.000Z', project: prj }));
    expect(result.ok).toBe(true);
    expect(result.data.total).toBeGreaterThanOrEqual(3);
    const kinds = result.data.items.map((i: any) => i.kind);
    expect(kinds).toContain('task');
    expect(kinds).toContain('knowledge');
    expect(kinds).toContain('memory');
    expect(result.data.items.find((i: any) => i.id === task!.id)).toMatchObject({ kind: 'task', change: 'closed' });
    expect(result.data.items.find((i: any) => i.id === doc!.id)).toMatchObject({ kind: 'knowledge', change: 'updated' });
    expect(result.data.items.find((i: any) => i.kind === 'memory')).toMatchObject({
      title: 'Deploys happen on Fridays.',
      change: 'recorded',
    });
    const dates = result.data.items.map((i: any) => Date.parse(i.updatedAt));
    for (let i = 1; i < dates.length; i++) expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    expect(Date.parse(result.data.nextSince)).toBeGreaterThanOrEqual(Date.parse('2000-01-01T00:00:00.000Z'));
  });

  it('filters kinds and honors limit', async () => {
    const prj = 'changes-b';
    await tools.createTask({ project: prj, title: 'T1', priority: 'low' });
    await tools.createTask({ project: prj, title: 'T2', priority: 'low' });
    const onlyTasks = parse(await handler({ since: '2000-01-01', project: prj, types: ['task'], limit: 1 }));
    expect(onlyTasks.ok).toBe(true);
    expect(onlyTasks.data.total).toBe(2);
    expect(onlyTasks.data.items).toHaveLength(1);
    expect(onlyTasks.data.items[0].kind).toBe('task');
  });

  it('returns an empty delta for a future since and preserves it', async () => {
    const result = parse(await handler({ since: '2999-01-01T00:00:00.000Z' }));
    expect(result.ok).toBe(true);
    expect(result.data.total).toBe(0);
    expect(result.data.nextSince).toBe('2999-01-01T00:00:00.000Z');
  });

  it('rejects an invalid since with INVALID_SINCE', async () => {
    const result = parse(await handler({ since: 'not-a-date' }));
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_SINCE');
  });

  it('excludes archived/trashed items unless includeDeleted is true', async () => {
    const prj = 'changes-c';
    const t = await tools.createTask({ project: prj, title: 'Archived', priority: 'low' });
    await tools.updateTask(prj, t!.id, { archived: true } as never);

    const hidden = parse(await handler({ since: '2000-01-01', project: prj }));
    expect(hidden.data.items.some((i: any) => i.id === t!.id)).toBe(false);

    const shown = parse(await handler({ since: '2000-01-01', project: prj, includeDeleted: true }));
    expect(shown.data.items.find((i: any) => i.id === t!.id)).toMatchObject({ change: 'archived' });
  });
});
