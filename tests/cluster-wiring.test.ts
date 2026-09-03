/**
 * tests/cluster-wiring.test.ts — WIRE-003 container wiring tests
 *
 * Verifies AppContainer wires the ClusterManager singleton (AI-009 pattern):
 * self-node registration on init(), heartbeat lifecycle, cluster_* tool
 * registration, and graceful-shutdown cleanup (heartbeat stop + unregister).
 *
 * TD-013: heartbeat intervals use vi.useFakeTimers — no real sleeps.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppContainer } from '../src/core/app-container.js';
import { getClusterManager, resetClusterManager } from '../src/core/cluster.js';

const SELF_ID = 'wire-test-node';

beforeEach(() => {
  resetClusterManager();
  vi.useRealTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  resetClusterManager();
});

function makeApp(): AppContainer {
  return new AppContainer({
    transportType: 'http',
    host: '127.0.0.1',
    port: 3999,
    handleSignals: false,
    cluster: { selfId: SELF_ID, host: '127.0.0.1', port: 3999, heartbeatMs: 1000 },
  });
}

describe('WIRE-003 — container creates ClusterManager on init', () => {
  it('registers self node, exposes manager via getter + ctx, lists cluster_* tools', async () => {
    const app = makeApp();
    await app.init();
    try {
      const cm = app.getClusterManager();
      // Singleton-registry pattern (AI-009): container uses the shared instance
      expect(cm).toBe(getClusterManager());

      const node = cm.getNodes().find((n) => n.id === SELF_ID);
      expect(node).toBeDefined();
      expect(node?.status).toBe('active');
      expect(node?.host).toBe('127.0.0.1');
      expect(node?.port).toBe(3999);

      expect(app.getContext().clusterManager).toBe(cm);

      const names = app.getContext().toolNames;
      expect(names.has('cluster_status')).toBe(true);
      expect(names.has('cluster_nodes')).toBe(true);
      expect(names.has('cluster_assign')).toBe(true);

      // Backed by the real manager: session affinity resolves to the self node
      expect(cm.assignSession('sess-wire-1')).toBe(SELF_ID);
    } finally {
      await app.stop();
    }
  });

  it('heartbeat refreshes self lastHeartbeat on fake timers', async () => {
    vi.useFakeTimers();
    const app = makeApp();
    await app.init();
    try {
      const cm = app.getClusterManager();
      const before = cm.getNodes().find((n) => n.id === SELF_ID)?.lastHeartbeat;
      expect(before).toBeDefined();

      await vi.advanceTimersByTimeAsync(1000);

      const after = cm.getNodes().find((n) => n.id === SELF_ID)?.lastHeartbeat;
      expect(after).toBeDefined();
      expect(new Date(after as string).getTime()).toBeGreaterThan(
        new Date(before as string).getTime(),
      );
    } finally {
      await app.stop();
    }
  });

  it('stop() halts heartbeat and unregisters self node (graceful shutdown)', async () => {
    vi.useFakeTimers();
    const app = makeApp();
    await app.init();
    const cm = app.getClusterManager();
    await vi.advanceTimersByTimeAsync(1000);

    const atStop = cm.getNodes().find((n) => n.id === SELF_ID)?.lastHeartbeat;
    expect(atStop).toBeDefined();

    await app.stop();

    // Cleanup unregistered the self node; advancing time post-stop revives nothing
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cm.getNodes().find((n) => n.id === SELF_ID)).toBeUndefined();
  });

  it('stdio transport skips cluster (single-node mode)', async () => {
    const app = new AppContainer({ transportType: 'stdio', handleSignals: false });
    await app.init();
    try {
      expect(() => app.getClusterManager()).toThrow(/cluster manager not available/);
      expect(app.getContext().clusterManager).toBeUndefined();
    } finally {
      await app.stop();
    }
  });

  it('cluster:false disables wiring even for http', async () => {
    const app = new AppContainer({ transportType: 'http', handleSignals: false, cluster: false });
    await app.init();
    try {
      expect(() => app.getClusterManager()).toThrow(/cluster manager not available/);
      expect(app.getContext().clusterManager).toBeUndefined();
    } finally {
      await app.stop();
    }
  });
});
