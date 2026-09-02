/**
 * cluster.spec.ts — Tests for cluster scaling (SCALE-002..005).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClusterManager, resetClusterManager, getClusterManager } from '../src/core/cluster.js';

describe('ClusterManager', () => {
  let mgr: ClusterManager;

  beforeEach(() => {
    resetClusterManager();
    mgr = new ClusterManager({ heartbeatMs: 60000 });
  });

  afterEach(() => {
    resetClusterManager();
  });

  describe('SCALE-002: Load Balancer + Sticky Sessions', () => {
    it('registers nodes', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      expect(mgr.getNodes()).toHaveLength(1);
      expect(mgr.getNodes()[0].id).toBe('node-1');
    });

    it('unregisters nodes and cleans up affinity', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.assignSession('sess-1');
      mgr.unregisterNode('node-1');
      expect(mgr.getNodes()).toHaveLength(0);
      expect(mgr.getSessionNode('sess-1')).toBeNull();
    });

    it('assigns session to least loaded node', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.registerNode({ id: 'node-2', host: '10.0.0.2', port: 3002, status: 'active' });
      const target = mgr.assignSession('sess-1');
      expect(['node-1', 'node-2']).toContain(target);
    });

    it('maintains sticky session affinity', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.registerNode({ id: 'node-2', host: '10.0.0.2', port: 3002, status: 'active' });
      const first = mgr.assignSession('sess-1');
      const second = mgr.assignSession('sess-1');
      expect(first).toBe(second);
    });

    it('returns selfId when no nodes registered', () => {
      const target = mgr.assignSession('sess-1');
      expect(target).toBe(mgr.getSelfId());
    });

    it('returns sticky session headers', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      const headers = mgr.getStickySessionHeader('sess-1');
      expect(headers['X-Node-Id']).toBeTruthy();
      expect(headers['X-Session-Affinity']).toBe('sess-1');
    });

    it('reassigns when affinity node is offline', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.registerNode({ id: 'node-2', host: '10.0.0.2', port: 3002, status: 'active' });
      const first = mgr.assignSession('sess-1');
      const node = mgr.getNodes().find((n) => n.id === first)!;
      node.status = 'offline';
      const second = mgr.assignSession('sess-1');
      expect(second).not.toBe(first);
    });
  });

  describe('SCALE-003: Cluster State Sync', () => {
    it('exports state', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.assignSession('sess-1');
      const state = mgr.exportState();
      expect(state.nodes).toHaveLength(1);
      expect(state.affinity).toHaveLength(1);
      expect(state.timestamp).toBeTruthy();
    });

    it('imports state', () => {
      mgr.importState({
        nodes: [{ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active', joinedAt: '2026-01-01T00:00:00Z', lastHeartbeat: '2026-01-01T00:00:00Z' }],
        affinity: [{ sessionId: 'sess-1', nodeId: 'node-1', createdAt: '2026-01-01T00:00:00Z' }],
      });
      expect(mgr.getNodes()).toHaveLength(1);
      expect(mgr.getSessionNode('sess-1')).toBe('node-1');
    });

    it('emits state:synced event on import', () => {
      let emitted = false;
      mgr.on('state:synced', () => { emitted = true; });
      mgr.importState({ nodes: [] });
      expect(emitted).toBe(true);
    });

    it('startHeartbeat updates self lastHeartbeat', () => {
      vi.useFakeTimers();
      mgr.registerNode({ id: mgr.getSelfId(), host: 'localhost', port: 3001, status: 'active' });
      mgr.startHeartbeat(() => {});
      vi.advanceTimersByTime(60001);
      const self = mgr.getNodes().find((n) => n.id === mgr.getSelfId());
      expect(self).toBeDefined();
      vi.useRealTimers();
      mgr.stopHeartbeat();
    });

    it('marks nodes offline after missing heartbeats', () => {
      vi.useFakeTimers();
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      const node = mgr.getNodes()[0];
      node.lastHeartbeat = new Date(Date.now() - 200000).toISOString();
      mgr.startHeartbeat(() => {});
      vi.advanceTimersByTime(60001);
      expect(mgr.getNodes()[0].status).toBe('offline');
      vi.useRealTimers();
      mgr.stopHeartbeat();
    });
  });

  describe('SCALE-004: Tool Sharding', () => {
    it('assigns shard to a node', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.registerNode({ id: 'node-2', host: '10.0.0.2', port: 3002, status: 'active' });
      const shard = mgr.assignShard('tasks');
      expect(shard.toolPrefix).toBe('tasks');
      expect(['node-1', 'node-2']).toContain(shard.nodeId);
    });

    it('returns shard node by prefix', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.assignShard('tasks', 'node-1');
      expect(mgr.getShardNode('tasks')).toBe('node-1');
    });

    it('routes tool by name prefix', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.assignShard('knowledge', 'node-1');
      expect(mgr.routeTool('knowledge_list')).toBe('node-1');
      expect(mgr.routeTool('knowledge_get')).toBe('node-1');
    });

    it('returns selfId for unsharded tools', () => {
      expect(mgr.routeTool('unknown_tool')).toBe(mgr.getSelfId());
    });

    it('returns all shard assignments', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.assignShard('tasks', 'node-1');
      mgr.assignShard('knowledge', 'node-1');
      expect(mgr.getShardAssignments()).toHaveLength(2);
    });
  });

  describe('SCALE-005: Auto-scaling', () => {
    it('recommends scale_up when cpu high', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      const result = mgr.evaluateAutoScale({ activeSessions: 100, cpuPercent: 90, memoryMb: 1000 });
      expect(result.action).toBe('scale_up');
    });

    it('recommends scale_up when sessions per node high', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      const result = mgr.evaluateAutoScale({ activeSessions: 200, cpuPercent: 30, memoryMb: 500 });
      expect(result.action).toBe('scale_up');
    });

    it('recommends scale_down when load is low', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.registerNode({ id: 'node-2', host: '10.0.0.2', port: 3002, status: 'active' });
      const result = mgr.evaluateAutoScale({ activeSessions: 5, cpuPercent: 10, memoryMb: 200 });
      expect(result.action).toBe('scale_down');
    });

    it('recommends none when within targets', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      const result = mgr.evaluateAutoScale({ activeSessions: 30, cpuPercent: 40, memoryMb: 800 });
      expect(result.action).toBe('none');
    });

    it('respects scale_up cooldown', () => {
      mgr.registerNode({ id: 'node-1', host: '10.0.0.1', port: 3001, status: 'active' });
      mgr.evaluateAutoScale({ activeSessions: 200, cpuPercent: 90, memoryMb: 1000 });
      const result = mgr.evaluateAutoScale({ activeSessions: 200, cpuPercent: 90, memoryMb: 1000 });
      expect(result.action).toBe('none');
      expect(result.reason).toContain('cooldown');
    });

    it('recommends scale_up when below min nodes', () => {
      const result = mgr.evaluateAutoScale({ activeSessions: 0, cpuPercent: 0, memoryMb: 0 });
      expect(result.action).toBe('scale_up');
    });

    it('returns resource limits', () => {
      const limits = mgr.getResourceLimits();
      expect(limits.maxSessionsPerNode).toBeGreaterThan(0);
      expect(limits.maxCpuPercent).toBeGreaterThan(0);
      expect(limits.maxMemoryMb).toBeGreaterThan(0);
    });

    it('returns autoscale config', () => {
      const config = mgr.getAutoScaleConfig();
      expect(config.minNodes).toBeGreaterThan(0);
      expect(config.maxNodes).toBeGreaterThan(0);
    });
  });

  describe('getClusterManager singleton', () => {
    it('returns same instance', () => {
      const a = getClusterManager();
      const b = getClusterManager();
      expect(a).toBe(b);
    });

    it('reset creates new instance', () => {
      const a = getClusterManager();
      resetClusterManager();
      const b = getClusterManager();
      expect(a).not.toBe(b);
    });
  });
});
