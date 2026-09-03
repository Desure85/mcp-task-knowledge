import { z } from "zod";
import type { ServerContext } from './context.js';
import { ok, err } from '../utils/respond.js';

export function registerClusterTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "cluster_status",
    {
      title: "Cluster Status",
      description: "Cluster membership overview: self node ID, total/active node counts, session affinity and shard counts. If ClusterManager is not available (e.g. stdio single-node mode), returns availability status only.",
      inputSchema: {},
    },
    async () => {
      const cm = ctx.clusterManager;
      if (!cm) {
        return ok({
          available: false,
          reason: 'ClusterManager not initialized — clustering is only available for multi-client transports (TCP, HTTP).',
          clusteringEnabled: false,
        });
      }
      const nodes = cm.getNodes();
      const state = cm.exportState();
      return ok({
        available: true,
        clusteringEnabled: true,
        selfId: cm.getSelfId(),
        nodeCount: nodes.length,
        activeNodeCount: cm.getActiveNodes().length,
        affinityCount: state.affinity.length,
        shardCount: state.shards.length,
      });
    }
  );

  ctx.server.registerTool(
    "cluster_nodes",
    {
      title: "Cluster Nodes",
      description: "List all known cluster nodes with status and heartbeat info.",
      inputSchema: {},
    },
    async () => {
      const cm = ctx.clusterManager;
      if (!cm) {
        return ok({
          available: false,
          reason: 'ClusterManager not initialized.',
          nodes: [],
        });
      }
      return ok({ available: true, nodes: cm.getNodes() });
    }
  );

  ctx.server.registerTool(
    "cluster_assign",
    {
      title: "Cluster Assign Session",
      description: "Assign a session to a cluster node (sticky affinity) and return the target node ID plus routing headers.",
      inputSchema: {
        sessionId: z.string().min(1).describe("Session ID to assign"),
      },
    },
    async ({ sessionId }: { sessionId: string }) => {
      const cm = ctx.clusterManager;
      if (!cm) {
        return err('ClusterManager not initialized — clustering is only available for multi-client transports.');
      }
      const nodeId = cm.assignSession(sessionId);
      return ok({ nodeId, headers: cm.getStickySessionHeader(sessionId) });
    }
  );
}
