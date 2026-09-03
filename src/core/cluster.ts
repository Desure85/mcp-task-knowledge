/**
 * cluster.ts — Cluster scaling features (SCALE-002..005).
 *
 * - SCALE-002: Load balancer integration + sticky sessions
 * - SCALE-003: Cluster state synchronization (session/registry replication)
 * - SCALE-004: Tool sharding across nodes
 * - SCALE-005: Auto-scaling and resource limits
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NodeInfo {
  id: string;
  host: string;
  port: number;
  status: 'active' | 'draining' | 'offline';
  metadata?: Record<string, unknown>;
  joinedAt: string;
  lastHeartbeat: string;
}

export interface SessionAffinity {
  sessionId: string;
  nodeId: string;
  createdAt: string;
}

export interface ShardAssignment {
  toolPrefix: string;
  nodeId: string;
}

export interface ResourceLimits {
  maxSessionsPerNode: number;
  maxCpuPercent: number;
  maxMemoryMb: number;
}

export interface AutoScaleConfig {
  minNodes: number;
  maxNodes: number;
  targetCpuPercent: number;
  targetSessionsPerNode: number;
  scaleUpCooldownMs: number;
  scaleDownCooldownMs: number;
}

// ─── ClusterManager ──────────────────────────────────────────────────────────

export class ClusterManager extends EventEmitter {
  private nodes = new Map<string, NodeInfo>();
  private affinity = new Map<string, SessionAffinity>();
  private shards = new Map<string, ShardAssignment>();
  private selfId: string;
  private heartbeatMs: number;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private resourceLimits: ResourceLimits;
  private autoScaleConfig: AutoScaleConfig;
  private lastScaleUp = 0;
  private lastScaleDown = 0;

  constructor(opts?: {
    selfId?: string;
    heartbeatMs?: number;
    resourceLimits?: Partial<ResourceLimits>;
    autoScaleConfig?: Partial<AutoScaleConfig>;
  }) {
    super();
    this.selfId = opts?.selfId ?? `node_${createHash('sha256').update(Date.now().toString()).digest('hex').substring(0, 12)}`;
    this.heartbeatMs = opts?.heartbeatMs ?? 10_000;
    this.resourceLimits = {
      maxSessionsPerNode: opts?.resourceLimits?.maxSessionsPerNode ?? 100,
      maxCpuPercent: opts?.resourceLimits?.maxCpuPercent ?? 80,
      maxMemoryMb: opts?.resourceLimits?.maxMemoryMb ?? 2048,
    };
    this.autoScaleConfig = {
      minNodes: opts?.autoScaleConfig?.minNodes ?? 1,
      maxNodes: opts?.autoScaleConfig?.maxNodes ?? 10,
      targetCpuPercent: opts?.autoScaleConfig?.targetCpuPercent ?? 60,
      targetSessionsPerNode: opts?.autoScaleConfig?.targetSessionsPerNode ?? 50,
      scaleUpCooldownMs: opts?.autoScaleConfig?.scaleUpCooldownMs ?? 60_000,
      scaleDownCooldownMs: opts?.autoScaleConfig?.scaleDownCooldownMs ?? 300_000,
    };
  }

  // ─── SCALE-002: Load Balancer + Sticky Sessions ───────────────────────────

  registerNode(node: Omit<NodeInfo, 'joinedAt' | 'lastHeartbeat'>): void {
    const now = new Date().toISOString();
    const full: NodeInfo = { ...node, joinedAt: now, lastHeartbeat: now };
    this.nodes.set(node.id, full);
    this.emit('node:join', full);
  }

  unregisterNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.nodes.delete(nodeId);
    for (const [sid, aff] of this.affinity) {
      if (aff.nodeId === nodeId) this.affinity.delete(sid);
    }
    for (const [prefix, shard] of this.shards) {
      if (shard.nodeId === nodeId) this.shards.delete(prefix);
    }
    this.emit('node:leave', node);
  }

  assignSession(sessionId: string): string {
    const existing = this.affinity.get(sessionId);
    if (existing && this.nodes.get(existing.nodeId)?.status === 'active') {
      return existing.nodeId;
    }

    const activeNodes = Array.from(this.nodes.values()).filter((n) => n.status === 'active');
    if (activeNodes.length === 0) return this.selfId;

    const target = selectByLoad(activeNodes, this.affinity);
    this.affinity.set(sessionId, {
      sessionId,
      nodeId: target.id,
      createdAt: new Date().toISOString(),
    });
    this.emit('session:assigned', { sessionId, nodeId: target.id });
    return target.id;
  }

  getSessionNode(sessionId: string): string | null {
    return this.affinity.get(sessionId)?.nodeId ?? null;
  }

  getStickySessionHeader(sessionId: string): Record<string, string> {
    const nodeId = this.assignSession(sessionId);
    return { 'X-Node-Id': nodeId, 'X-Session-Affinity': sessionId };
  }

  // ─── SCALE-003: Cluster State Synchronization ─────────────────────────────

  exportState(): {
    nodes: NodeInfo[];
    affinity: SessionAffinity[];
    shards: ShardAssignment[];
    timestamp: string;
  } {
    return {
      nodes: Array.from(this.nodes.values()),
      affinity: Array.from(this.affinity.values()),
      shards: Array.from(this.shards.values()),
      timestamp: new Date().toISOString(),
    };
  }

  importState(state: {
    nodes?: NodeInfo[];
    affinity?: SessionAffinity[];
    shards?: ShardAssignment[];
  }): void {
    if (state.nodes) {
      for (const node of state.nodes) {
        this.nodes.set(node.id, node);
      }
    }
    if (state.affinity) {
      for (const aff of state.affinity) {
        this.affinity.set(aff.sessionId, aff);
      }
    }
    if (state.shards) {
      for (const shard of state.shards) {
        this.shards.set(shard.toolPrefix, shard);
      }
    }
    this.emit('state:synced', state);
  }

  startHeartbeat(onBeat: () => void): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      const self = this.nodes.get(this.selfId);
      if (self) {
        self.lastHeartbeat = new Date().toISOString();
      }
      this.checkNodeHealth();
      onBeat();
    }, this.heartbeatMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private checkNodeHealth(): void {
    const now = Date.now();
    for (const [id, node] of this.nodes) {
      if (id === this.selfId) continue;
      const elapsed = now - new Date(node.lastHeartbeat).getTime();
      if (elapsed > this.heartbeatMs * 3) {
        node.status = 'offline';
        this.emit('node:stale', node);
      }
    }
  }

  // ─── SCALE-004: Tool Sharding ─────────────────────────────────────────────

  assignShard(toolPrefix: string, nodeId?: string): ShardAssignment {
    const existing = this.shards.get(toolPrefix);
    if (existing && this.nodes.get(existing.nodeId)?.status === 'active') {
      return existing;
    }

    const target = nodeId ?? this.selectShardNode(toolPrefix);
    const assignment: ShardAssignment = { toolPrefix, nodeId: target };
    this.shards.set(toolPrefix, assignment);
    this.emit('shard:assigned', assignment);
    return assignment;
  }

  getShardNode(toolPrefix: string): string | null {
    const exact = this.shards.get(toolPrefix);
    if (exact) return exact.nodeId;
    for (const [prefix, shard] of this.shards) {
      if (toolPrefix.startsWith(prefix)) return shard.nodeId;
    }
    return null;
  }

  routeTool(toolName: string): string | null {
    const prefix = toolName.split('_')[0];
    return this.getShardNode(prefix) ?? this.selfId;
  }

  getShardAssignments(): ShardAssignment[] {
    return Array.from(this.shards.values());
  }

  private selectShardNode(prefix: string): string {
    const hash = createHash('sha256').update(prefix).digest('hex');
    const activeNodes = Array.from(this.nodes.values()).filter((n) => n.status === 'active');
    if (activeNodes.length === 0) return this.selfId;
    const idx = parseInt(hash.substring(0, 8), 16) % activeNodes.length;
    return activeNodes[idx].id;
  }

  // ─── SCALE-005: Auto-scaling ──────────────────────────────────────────────

  evaluateAutoScale(metrics: {
    activeSessions: number;
    cpuPercent: number;
    memoryMb: number;
  }): { action: 'scale_up' | 'scale_down' | 'none'; reason: string } {
    const now = Date.now();
    const activeCount = Array.from(this.nodes.values()).filter((n) => n.status === 'active').length;

    if (activeCount < this.autoScaleConfig.minNodes) {
      return { action: 'scale_up', reason: `below min nodes (${activeCount} < ${this.autoScaleConfig.minNodes})` };
    }

    if (activeCount > this.autoScaleConfig.maxNodes) {
      return { action: 'scale_down', reason: `above max nodes (${activeCount} > ${this.autoScaleConfig.maxNodes})` };
    }

    const sessionsPerNode = activeCount > 0 ? metrics.activeSessions / activeCount : 0;

    if (
      (metrics.cpuPercent > this.autoScaleConfig.targetCpuPercent ||
        sessionsPerNode > this.autoScaleConfig.targetSessionsPerNode) &&
      activeCount < this.autoScaleConfig.maxNodes
    ) {
      if (now - this.lastScaleUp < this.autoScaleConfig.scaleUpCooldownMs) {
        return { action: 'none', reason: 'scale_up cooldown' };
      }
      this.lastScaleUp = now;
      return {
        action: 'scale_up',
        reason: `cpu=${metrics.cpuPercent}% (target=${this.autoScaleConfig.targetCpuPercent}%), sessions/node=${sessionsPerNode.toFixed(1)} (target=${this.autoScaleConfig.targetSessionsPerNode})`,
      };
    }

    if (
      metrics.cpuPercent < this.autoScaleConfig.targetCpuPercent * 0.5 &&
      sessionsPerNode < this.autoScaleConfig.targetSessionsPerNode * 0.3 &&
      activeCount > this.autoScaleConfig.minNodes
    ) {
      if (now - this.lastScaleDown < this.autoScaleConfig.scaleDownCooldownMs) {
        return { action: 'none', reason: 'scale_down cooldown' };
      }
      this.lastScaleDown = now;
      return {
        action: 'scale_down',
        reason: `cpu=${metrics.cpuPercent}% (low), sessions/node=${sessionsPerNode.toFixed(1)} (low)`,
      };
    }

    return { action: 'none', reason: 'within targets' };
  }

  getResourceLimits(): ResourceLimits {
    return { ...this.resourceLimits };
  }

  getAutoScaleConfig(): AutoScaleConfig {
    return { ...this.autoScaleConfig };
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  getNodes(): NodeInfo[] {
    return Array.from(this.nodes.values());
  }

  getActiveNodes(): NodeInfo[] {
    return this.getNodes().filter((n) => n.status === 'active');
  }

  getSelfId(): string {
    return this.selfId;
  }

  /**
   * Override the self node ID (WIRE-003: AppContainer applies the configured
   * cluster.selfId before self-registration so heartbeat refresh targets the
   * registered node).
   */
  setSelfId(id: string): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('[cluster] selfId must be a non-empty string');
    }
    this.selfId = id;
  }

  /**
   * Override the heartbeat interval (WIRE-003: AppContainer applies the
   * configured cluster.heartbeatMs before startHeartbeat).
   */
  setHeartbeatMs(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error('[cluster] heartbeatMs must be a positive number');
    }
    this.heartbeatMs = ms;
  }
}

function selectByLoad(nodes: NodeInfo[], affinity: Map<string, SessionAffinity>): NodeInfo {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.id, 0);
  for (const aff of affinity.values()) {
    counts.set(aff.nodeId, (counts.get(aff.nodeId) ?? 0) + 1);
  }
  let minCount = Infinity;
  let target = nodes[0];
  for (const node of nodes) {
    const count = counts.get(node.id) ?? 0;
    if (count < minCount) {
      minCount = count;
      target = node;
    }
  }
  return target;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let singleton: ClusterManager | null = null;

export function getClusterManager(): ClusterManager {
  if (!singleton) {
    singleton = new ClusterManager();
  }
  return singleton;
}

export function resetClusterManager(): void {
  singleton?.stopHeartbeat();
  singleton = null;
}
