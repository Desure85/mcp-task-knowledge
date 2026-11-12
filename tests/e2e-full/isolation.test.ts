/**
 * TR-04g — DATA_DIR isolation for concurrent e2e servers.
 *
 * Two real stdio servers started at the same time must get distinct stores and
 * must not see each other's tasks. This is the regression guard for the old
 * shared `/tmp/mcp-data` races; it also exercises the shared harness rather
 * than a bespoke spawn block.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnServer, type E2EServer } from './harness.js';

const servers: E2EServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
});

describe('TR-04g e2e DATA_DIR isolation', () => {
  it('two concurrent servers have distinct stores and no cross-project leakage', async () => {
    const [a, b] = await Promise.all([spawnServer('iso-a'), spawnServer('iso-b')]);
    servers.push(a, b);
    expect(a.store).not.toBe(b.store);

    const created = await a.callTool('tasks_create', { project: 'iso-a', title: 'only in A' });
    expect(created.env.ok, JSON.stringify(created.env)).toBe(true);

    const inA = await a.callTool('tasks_list', { project: 'iso-a' });
    expect(inA.env.ok).toBe(true);
    expect(JSON.stringify(inA.env)).toContain('only in A');

    const inB = await b.callTool('tasks_list', { project: 'iso-a' });
    expect(inB.env.ok).toBe(true);
    expect(JSON.stringify(inB.env)).not.toContain('only in A');
  });
});
