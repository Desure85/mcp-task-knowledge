/**
 * U-01: task claim/lease.
 *
 * Lease semantics:
 *   - one active holder per task (bySessionId); re-claim by the holder renews;
 *   - a foreign active claim is rejected with code TASK_CLAIMED and holder info;
 *   - expired claims never block and are hidden on read, pruned on write/sweep;
 *   - claim/renew/release never touch updatedAt (MU-02 `version` must stay clean).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-task-claim');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';
process.env.TASK_CLAIM_SWEEP_MS = '0';

import type * as TasksNS from '../src/storage/tasks.js';
import type * as TasksToolsNS from '../src/register/tasks.js';
import { SessionManager } from '../src/core/session-manager.js';

let tasks: typeof TasksNS;
let tools: Map<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }>;

function uniqProj(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function rmrf(p: string): Promise<void> {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function captureTools(ctx: unknown): Map<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }> {
  const map = new Map<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }>();
  const captureCtx = {
    ...(ctx as Record<string, unknown>),
    server: {
      registerTool(name: string, _schema: unknown, handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>) {
        map.set(name, { handler });
      },
    },
  };
  (toolsModule as typeof TasksToolsNS).registerTasksTools(captureCtx as never);
  return map;
}

let toolsModule: typeof TasksToolsNS;

function envelope(res: unknown): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { message: string; code?: string; hint?: string; details?: Record<string, unknown> };
} {
  const content = (res as { content: { text: string }[] }).content;
  return JSON.parse(content[0].text);
}

function session(sid: string): { sessionId: string } {
  return { sessionId: sid };
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  toolsModule = await import('../src/register/tasks.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('U-01: storage claim/lease', () => {
  it('claims a task with holder, timestamps and default TTL', async () => {
    const prj = uniqProj('claim');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    const before = Date.now();

    const res = await tasks.claimTask(prj, task.id, { sessionId: 's1', userId: 'u1', client: 'claude-code' });
    expect(res.status).toBe('claimed');
    if (res.status !== 'claimed') throw new Error('unreachable');

    expect(res.claim.bySessionId).toBe('s1');
    expect(res.claim.byUserId).toBe('u1');
    expect(res.claim.client).toBe('claude-code');
    expect(Date.parse(res.claim.expiresAt)).toBeGreaterThan(before + (tasks.DEFAULT_CLAIM_TTL_SEC - 5) * 1000);

    const read = await tasks.getTask(prj, task.id);
    expect(read?.claim).toEqual(res.claim);
  });

  it('re-claim by the same holder renews and keeps claimedAt', async () => {
    const prj = uniqProj('renew-self');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    const first = await tasks.claimTask(prj, task.id, { sessionId: 's1', ttlSec: 60 });
    if (first.status !== 'claimed') throw new Error('expected claimed');

    await new Promise((r) => setTimeout(r, 5));
    const second = await tasks.claimTask(prj, task.id, { sessionId: 's1', ttlSec: 120 });
    expect(second.status).toBe('renewed');
    if (second.status !== 'renewed') throw new Error('unreachable');
    expect(second.claim.claimedAt).toBe(first.claim.claimedAt);
    expect(Date.parse(second.claim.expiresAt)).toBeGreaterThan(Date.parse(first.claim.expiresAt));
  });

  it('rejects a foreign active claim with the holder visible', async () => {
    const prj = uniqProj('foreign');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    const first = await tasks.claimTask(prj, task.id, { sessionId: 's1', client: 'claude-code' });
    if (first.status !== 'claimed') throw new Error('expected claimed');

    const blocked = await tasks.claimTask(prj, task.id, { sessionId: 's2', client: 'opencode' });
    expect(blocked.status).toBe('claimed_by_other');
    if (blocked.status !== 'claimed_by_other') throw new Error('unreachable');
    expect(blocked.claim.bySessionId).toBe('s1');
    expect(blocked.claim.client).toBe('claude-code');
  });

  it('renew updates heartbeat/expiry but never updatedAt (MU-02 stays clean)', async () => {
    const prj = uniqProj('renew-version');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    const before = await tasks.getTask(prj, task.id);
    const claimed = await tasks.claimTask(prj, task.id, { sessionId: 's1', ttlSec: 60 });
    if (claimed.status !== 'claimed') throw new Error('expected claimed');

    await new Promise((r) => setTimeout(r, 5));
    const renewed = await tasks.renewTaskClaim(prj, task.id, { sessionId: 's1', ttlSec: 600 });
    expect(renewed.status).toBe('renewed');
    const after = await tasks.getTask(prj, task.id);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect((after as unknown as { version?: number }).version).toBeUndefined();
    expect(after?.claim?.heartbeatAt).not.toBe(claimed.claim.heartbeatAt);
    expect(Date.parse(after!.claim!.expiresAt)).toBeGreaterThan(Date.parse(claimed.claim.expiresAt));
  });

  it('renew fails for a non-holder and for a task with no claim', async () => {
    const prj = uniqProj('renew-errors');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    expect((await tasks.renewTaskClaim(prj, task.id, { sessionId: 's1' })).status).toBe('not_claimed');

    await tasks.claimTask(prj, task.id, { sessionId: 's1' });
    const other = await tasks.renewTaskClaim(prj, task.id, { sessionId: 's2' });
    expect(other.status).toBe('claimed_by_other');
  });

  it('release by holder frees the task; foreign release is rejected; free release is idempotent', async () => {
    const prj = uniqProj('release');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    await tasks.claimTask(prj, task.id, { sessionId: 's1' });

    expect((await tasks.releaseTaskClaim(prj, task.id, { sessionId: 's2' })).status).toBe('claimed_by_other');
    expect((await tasks.releaseTaskClaim(prj, task.id, { sessionId: 's1' })).status).toBe('released');
    expect((await tasks.releaseTaskClaim(prj, task.id, { sessionId: 's1' })).status).toBe('not_claimed');
    expect((await tasks.claimTask(prj, task.id, { sessionId: 's2' })).status).toBe('claimed');
  });

  it('expired claims stop blocking and are hidden on read (fake clock)', async () => {
    const prj = uniqProj('expiry');
    const task = await tasks.createTask({ project: prj, title: 'Work' });

    vi.useFakeTimers({ toFake: ['Date'] });
    const base = new Date('2026-10-30T10:00:00.000Z');
    vi.setSystemTime(base);
    const claimed = await tasks.claimTask(prj, task.id, { sessionId: 's1', ttlSec: 60 });
    expect(claimed.status).toBe('claimed');

    vi.setSystemTime(new Date(base.getTime() + 61_000));
    expect((await tasks.getTask(prj, task.id))?.claim).toBeUndefined();
    const listed = await tasks.listTasks({ project: prj });
    expect(listed[0].claim).toBeUndefined();

    const takeover = await tasks.claimTask(prj, task.id, { sessionId: 's2' });
    expect(takeover.status).toBe('claimed');
    if (takeover.status !== 'claimed') throw new Error('unreachable');
    expect(takeover.claim.bySessionId).toBe('s2');
  });

  it('pruneExpiredClaims removes only expired leases from disk', async () => {
    const prj = uniqProj('prune');
    const expiredTask = await tasks.createTask({ project: prj, title: 'Expired' });
    const liveTask = await tasks.createTask({ project: prj, title: 'Live' });

    vi.useFakeTimers({ toFake: ['Date'] });
    const base = new Date('2026-10-30T11:00:00.000Z');
    vi.setSystemTime(base);
    await tasks.claimTask(prj, expiredTask.id, { sessionId: 's1', ttlSec: 60 });
    await tasks.claimTask(prj, liveTask.id, { sessionId: 's1', ttlSec: 3600 });

    vi.setSystemTime(new Date(base.getTime() + 120_000));
    const pruned = await tasks.pruneExpiredClaims(prj);
    expect(pruned).toEqual([`${prj}/${expiredTask.id}`]);

    const rawExpired = JSON.parse(
      await fsp.readFile(path.join(process.env.DATA_DIR!, 'tasks', prj, `${expiredTask.id}.json`), 'utf8'),
    );
    const rawLive = JSON.parse(
      await fsp.readFile(path.join(process.env.DATA_DIR!, 'tasks', prj, `${liveTask.id}.json`), 'utf8'),
    );
    expect(rawExpired.claim).toBeUndefined();
    expect(rawLive.claim).toBeDefined();
  });

  it('two parallel claims from different sessions: exactly one wins', async () => {
    const prj = uniqProj('race');
    const task = await tasks.createTask({ project: prj, title: 'Contended' });

    const [a, b] = await Promise.all([
      tasks.claimTask(prj, task.id, { sessionId: 'agent-a', client: 'claude-code' }),
      tasks.claimTask(prj, task.id, { sessionId: 'agent-b', client: 'opencode' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['claimed', 'claimed_by_other']);

    const stored = await tasks.getTask(prj, task.id);
    const winner = a.status === 'claimed' ? 'agent-a' : 'agent-b';
    expect(stored?.claim?.bySessionId).toBe(winner);
  });

  it('claim/release do not bump updatedAt either', async () => {
    const prj = uniqProj('no-bump');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    const before = (await tasks.getTask(prj, task.id))!.updatedAt;
    await tasks.claimTask(prj, task.id, { sessionId: 's1' });
    await tasks.releaseTaskClaim(prj, task.id, { sessionId: 's1' });
    expect((await tasks.getTask(prj, task.id))!.updatedAt).toBe(before);
  });
});

describe('U-01: tools', () => {
  it('tasks_claim conflict returns stable TASK_CLAIMED code with holder and hint', async () => {
    const prj = uniqProj('tool-conflict');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    tools = captureTools({});

    const first = envelope(await tools.get('tasks_claim')!.handler({ project: prj, id: task.id }, session('s1')));
    expect(first.ok).toBe(true);
    expect((first.data?.claim as { bySessionId: string }).bySessionId).toBe('s1');

    const blockedRaw = await tools.get('tasks_claim')!.handler({ project: prj, id: task.id }, session('s2'));
    const blocked = envelope(blockedRaw);
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('TASK_CLAIMED');
    expect(blocked.error?.hint).toContain('expiresAt');
    expect((blocked.error?.details?.holder as { bySessionId: string }).bySessionId).toBe('s1');
    expect((blockedRaw as { isError?: boolean }).isError).toBe(true);
  });

  it('tasks_renew requires a claim; tasks_release is idempotent', async () => {
    const prj = uniqProj('tool-renew');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    tools = captureTools({});

    const notClaimed = envelope(await tools.get('tasks_renew')!.handler({ project: prj, id: task.id }, session('s1')));
    expect(notClaimed.ok).toBe(false);
    expect(notClaimed.error?.code).toBe('TASK_NOT_CLAIMED');

    const released = envelope(await tools.get('tasks_release')!.handler({ project: prj, id: task.id }, session('s1')));
    expect(released.ok).toBe(true);
    expect(released.data?.released).toBe(false);
    expect(released.data?.alreadyFree).toBe(true);
  });

  it('derives userId/client from session metadata and lets an explicit client override it', async () => {
    const prj = uniqProj('tool-identity');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    const sm = new SessionManager({ maxSessions: 10 });
    sm.create({ id: 'sess-meta', remote: '127.0.0.1', metadata: { userId: 'u42', client: 'opencode' } });
    tools = captureTools({ sessionManager: sm });

    const claimed = envelope(await tools.get('tasks_claim')!.handler(
      { project: prj, id: task.id, client: 'claude-code' },
      session('sess-meta'),
    ));
    expect(claimed.ok).toBe(true);
    const claim = claimed.data?.claim as { byUserId?: string; client?: string };
    expect(claim.byUserId).toBe('u42');
    expect(claim.client).toBe('claude-code');
    await sm.closeAll();
  });

  it('briefing shows the active claim for open tasks', async () => {
    // briefing lives in another registrar; assert through the task payload that
    // listTasks (its data source) exposes the claim.
    const prj = uniqProj('briefing');
    const task = await tasks.createTask({ project: prj, title: 'Work' });
    await tasks.claimTask(prj, task.id, { sessionId: 's1', client: 'opencode' });
    const listed = await tasks.listTasks({ project: prj });
    expect(listed[0].claim?.bySessionId).toBe('s1');
    expect(listed[0].claim?.client).toBe('opencode');
  });
});
