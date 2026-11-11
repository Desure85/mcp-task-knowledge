import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP = path.join(process.cwd(), '.tmp-tests-response-economy');
process.env.DATA_DIR = TMP;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');
let toolMap: Map<string, Handler>;

async function call(name: string, args: Record<string, unknown>) {
  const result = (await toolMap.get(name)!(args)) as { content?: Array<{ text?: string }> };
  return JSON.parse(result.content?.[0]?.text ?? '{}') as { ok: boolean; data?: any; error?: any };
}

beforeAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(path.join(TMP, 'vault'), { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  toolMap = new Map();
  const ctx = {
    server: {
      registerTool: (name: string, _def: unknown, handler: Handler) => toolMap.set(name, handler),
    },
  } as never;
  const { registerTasksTools } = await import('../src/register/tasks.js');
  const { registerKnowledgeTools } = await import('../src/register/knowledge.js');
  const { registerMemoryTools } = await import('../src/register/memory.js');
  registerTasksTools(ctx);
  registerKnowledgeTools(ctx);
  registerMemoryTools(ctx);
});

afterAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

describe('U-04 compact read responses', () => {
  it('tasks_list compact drops long text and empty values; default stays full', async () => {
    const project = 'economy-tasks';
    await tasks.createTask({ project, title: 'Compact me', description: 'x'.repeat(600), tags: [] });

    const full = await call('tasks_list', { project });
    expect(full.ok).toBe(true);
    expect(full.data[0].description).toHaveLength(600);

    const compact = await call('tasks_list', { project, compact: true });
    expect(compact.ok).toBe(true);
    expect(compact.data[0].id).toBeTruthy();
    expect(compact.data[0].title).toBe('Compact me');
    expect(compact.data[0].description).toBeUndefined();
    expect(compact.data[0].tags).toBeUndefined();
  });

  it('tasks_get supports compact and exact fields on both graph branches', async () => {
    const project = 'economy-get';
    const task = await tasks.createTask({ project, title: 'Get me', description: 'long', priority: 'high' });

    const compact = await call('tasks_get', { project, id: task!.id, compact: true });
    expect(compact.ok).toBe(true);
    expect(compact.data).toMatchObject({ id: task!.id, title: 'Get me', status: expect.any(String) });
    expect(compact.data.description).toBeUndefined();

    const fields = await call('tasks_get', { project, id: task!.id, fields: ['id', 'title'] });
    expect(fields.data).toEqual({ id: task!.id, title: 'Get me' });

    const graph = await call('tasks_get', { project, id: task!.id, includeGraphMetrics: true });
    expect(graph.ok).toBe(true);
    expect(graph.data.dependentsCount).toBe(0);

    const graphCompact = await call('tasks_get', { project, id: task!.id, includeGraphMetrics: true, compact: true });
    expect(graphCompact.ok).toBe(true);
    expect(graphCompact.data.description).toBeUndefined();
    expect(graphCompact.data.dependentsCount).toBeUndefined();
  });

  it('knowledge_list/get compact drop content; fields can request it explicitly', async () => {
    const project = 'economy-docs';
    const doc = await knowledge.createDoc({ project, title: 'Compact doc', content: 'body '.repeat(200), type: 'api' });

    const list = await call('knowledge_list', { project, compact: true });
    expect(list.ok).toBe(true);
    expect(list.data[0].title).toBe('Compact doc');
    expect(list.data[0].content).toBeUndefined();

    const compact = await call('knowledge_get', { project, id: doc!.id, compact: true });
    expect(compact.ok).toBe(true);
    expect(compact.data.title).toBe('Compact doc');
    expect(compact.data.content).toBeUndefined();

    const fields = await call('knowledge_get', { project, id: doc!.id, fields: ['id', 'content'] });
    expect(fields.data.id).toBe(doc!.id);
    expect(fields.data.content).toContain('body');
  });

  it('memory_facts_list/search accept compact without content', async () => {
    const project = 'economy-memory';
    await knowledge.createDoc({
      project,
      title: 'Memory compact fact',
      content: 'content '.repeat(100),
      type: 'memory_fact',
    });

    const list = await call('memory_facts_list', { project, compact: true });
    expect(list.ok).toBe(true);
    expect(list.data.facts[0].title).toBe('Memory compact fact');
    expect(list.data.facts[0].content).toBeUndefined();

    const search = await call('memory_facts_search', { project, query: 'Memory compact', compact: true });
    expect(search.ok).toBe(true);
    expect(search.data.results[0].title).toBe('Memory compact fact');
    expect(search.data.results[0].content).toBeUndefined();
  });
});
