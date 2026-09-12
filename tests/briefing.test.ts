/**
 * tests/briefing.test.ts — DX-13 `briefing` tool.
 *
 * Covers the assembled session-start context: open tasks sorted by priority,
 * recent docs, blockers (status=blocked + DAG-unmet deps), summary string.
 * Uses a mock ServerContext (cluster-tools.test.ts pattern) + real storage
 * in an isolated DATA_DIR.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-briefing');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

import { registerBriefingTools } from '../src/register/briefing.js';
import type { ServerContext } from '../src/register/context.js';
import type { ToolMetaHandler } from '../src/register/setup.js';

let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function createMockContext(): {
  ctx: ServerContext;
  getHandler: (name: string) => ToolMetaHandler | undefined;
} {
  const handlers = new Map<string, ToolMetaHandler>();
  const ctx: ServerContext = {
    server: {
      registerTool(name: string, _def: unknown, handler: unknown) {
        handlers.set(name, handler as ToolMetaHandler);
      },
    } as any,
    cfg: {} as any,
    catalogCfg: {} as any,
    catalogProvider: {} as any,
    vectorAdapter: undefined,
    vectorInitAttempted: false,
    ensureVectorAdapter: async () => undefined,
    toolRegistry: { has: () => false, set: vi.fn() } as any,
    resourceRegistry: [],
    toolNames: new Set(),
    STRICT_TOOL_DEDUP: false,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
    TOOL_RES_EXEC: false,
    REPO_ROOT: '/tmp',
    SERVER_CAPS: {
      resources: { subscribe: false, listChanged: false },
      tools: { listChanged: false },
      prompts: { listChanged: false },
      completion: {},
    },
    normalizeBase64: (s: string) => s,
    makeResourceTemplate: (p: string) => p as any,
    registerToolAsResource: vi.fn(),
  };
  return { ctx, getHandler: (name) => handlers.get(name) };
}

function parseEnvelope(result: any): any {
  const text = result?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : result;
}

async function callBriefing(args: Record<string, unknown>) {
  const { ctx, getHandler } = createMockContext();
  registerBriefingTools(ctx);
  const handler = getHandler('briefing');
  expect(handler).toBeDefined();
  const res = await handler!(args);
  return parseEnvelope(res);
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('briefing tool', () => {
  it('registers a tool named "briefing"', () => {
    const { ctx, getHandler } = createMockContext();
    registerBriefingTools(ctx);
    expect(getHandler('briefing')).toBeDefined();
  });

  it('returns empty state for a fresh project', async () => {
    const prj = uniqProj('empty');
    const env = await callBriefing({ project: prj });

    expect(env.ok).toBe(true);
    expect(env.data.project).toBe(prj);
    expect(env.data.openTasks).toEqual([]);
    expect(env.data.recentDocs).toEqual([]);
    expect(env.data.blockers).toEqual([]);
    expect(env.data.counts.openTasks).toBe(0);
    expect(env.data.counts.docs).toBe(0);
    expect(typeof env.data.summary).toBe('string');
    expect(env.data.summary).toContain(prj);
  });

  it('lists open tasks sorted by priority (high → medium → low)', async () => {
    const prj = uniqProj('prio');
    await tasks.createTask({ project: prj, title: 'low task', priority: 'low' });
    await tasks.createTask({ project: prj, title: 'high task', priority: 'high' });
    await tasks.createTask({ project: prj, title: 'med task', priority: 'medium' });
    await tasks.createTask({ project: prj, title: 'high task 2', priority: 'high' });

    const env = await callBriefing({ project: prj });
    expect(env.ok).toBe(true);
    expect(env.data.openTasks).toHaveLength(4);
    expect(env.data.openTasks[0].priority).toBe('high');
    expect(env.data.openTasks[1].priority).toBe('high');
    expect(env.data.openTasks[2].priority).toBe('medium');
    expect(env.data.openTasks[3].priority).toBe('low');
    // Shape check
    expect(env.data.openTasks[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      status: 'pending',
    });
  });

  it('excludes completed/closed tasks from openTasks', async () => {
    const prj = uniqProj('closed');
    const t1 = await tasks.createTask({ project: prj, title: 'open one' });
    const t2 = await tasks.createTask({ project: prj, title: 'to close' });
    if (t2) await tasks.closeTask(prj, t2.id);

    const env = await callBriefing({ project: prj });
    expect(env.data.openTasks).toHaveLength(1);
    expect(env.data.openTasks[0].id).toBe(t1!.id);
    expect(env.data.counts.openTasks).toBe(1);
  });

  it('respects maxTasks cap', async () => {
    const prj = uniqProj('cap');
    for (let i = 0; i < 8; i++) {
      await tasks.createTask({ project: prj, title: `T${i}`, priority: 'medium' });
    }
    const env = await callBriefing({ project: prj, maxTasks: 3 });
    expect(env.data.openTasks).toHaveLength(3);
    expect(env.data.counts.openTasks).toBe(8); // counts reflect reality, not cap
  });

  it('returns recent docs sorted by updatedAt desc, capped by maxDocs', async () => {
    const prj = uniqProj('docs');
    const d1 = await knowledge.createDoc({ project: prj, title: 'Doc A', content: 'a' });
    const d2 = await knowledge.createDoc({ project: prj, title: 'Doc B', content: 'b' });
    const d3 = await knowledge.createDoc({ project: prj, title: 'Doc C', content: 'c' });
    // Touch d1 so it becomes most recent
    if (d1) await knowledge.updateDoc(prj, d1.id, { title: 'Doc A updated' });

    const env = await callBriefing({ project: prj, maxDocs: 2 });
    expect(env.ok).toBe(true);
    expect(env.data.recentDocs).toHaveLength(2);
    expect(env.data.recentDocs[0].title).toBe('Doc A updated');
    expect(env.data.counts.docs).toBe(3);
    expect(env.data.recentDocs[0]).toMatchObject({
      id: expect.any(String),
      updatedAt: expect.any(String),
    });
    void d2; void d3;
  });

  it('reports status=blocked tasks as blockers', async () => {
    const prj = uniqProj('blocked');
    await tasks.createTask({ project: prj, title: 'stuck task', status: 'blocked' });
    await tasks.createTask({ project: prj, title: 'free task' });

    const env = await callBriefing({ project: prj });
    expect(env.data.blockers).toHaveLength(1);
    expect(env.data.blockers[0]).toMatchObject({
      type: 'task',
      title: 'stuck task',
    });
    expect(env.data.blockers[0].reason).toContain('blocked');
    expect(env.data.counts.blocked).toBe(1);
  });

  it('reports DAG-blocked tasks (unmet dependsOn) as blockers', async () => {
    const prj = uniqProj('dag');
    const dep = await tasks.createTask({ project: prj, title: 'dependency' });
    const dependent = await tasks.createTask({ project: prj, title: 'dependent task' });
    // createTask doesn't accept dependsOn — set via updateTask
    await tasks.updateTask(prj, dependent!.id, { dependsOn: [dep!.id] });

    const env = await callBriefing({ project: prj });
    expect(env.ok).toBe(true);
    const dagBlocker = env.data.blockers.find((b: any) => b.id === dependent!.id);
    expect(dagBlocker).toBeDefined();
    expect(dagBlocker.reason).toContain('unmet dependencies');
    expect(dagBlocker.blockingDeps).toContain(dep!.id);
  });

  it('does not report task as DAG-blocked once dependency is closed', async () => {
    const prj = uniqProj('dagok');
    const dep = await tasks.createTask({ project: prj, title: 'dep' });
    const dependent = await tasks.createTask({ project: prj, title: 'dependent' });
    await tasks.updateTask(prj, dependent!.id, { dependsOn: [dep!.id] });
    await tasks.closeTask(prj, dep!.id);

    const env = await callBriefing({ project: prj });
    const dagBlocker = env.data.blockers.find((b: any) => b.id === dependent!.id);
    expect(dagBlocker).toBeUndefined();
  });

  it('summary string mentions counts and project', async () => {
    const prj = uniqProj('sum');
    await tasks.createTask({ project: prj, title: 'one' });
    await tasks.createTask({ project: prj, title: 'two', status: 'in_progress' });
    await knowledge.createDoc({ project: prj, title: 'doc', content: 'x' });

    const env = await callBriefing({ project: prj });
    expect(env.data.summary).toContain('2 open tasks');
    expect(env.data.summary).toContain('1 in progress');
    expect(env.data.summary).toContain('1 knowledge doc');
    expect(env.data.summary).toContain(prj);
  });

  it('defaults to current project when project arg omitted', async () => {
    const env = await callBriefing({});
    expect(env.ok).toBe(true);
    expect(typeof env.data.project).toBe('string');
    expect(env.data.project.length).toBeGreaterThan(0);
  });
});
