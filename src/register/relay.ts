/**
 * register/relay.ts — LAN Relay tools (BM-012)
 * relay_status, share_brief, broadcast_rule — registered only when the
 * relay manager is enabled.
 */

import { z } from 'zod';
import type { ServerContext } from './context.js';
import { ok, err } from '../utils/respond.js';

export function registerRelayTools(ctx: ServerContext): void {
  const relay = ctx.relayManager;
  if (!relay?.enabled) return;

  ctx.server.registerTool(
    'relay_status',
    {
      title: 'Relay Status',
      description: 'Show LAN relay status: enabled, port, discovered peers, connections, encryption',
      inputSchema: {},
    },
    async () => ok(relay.status()),
  );

  ctx.server.registerTool(
    'share_brief',
    {
      title: 'Share Brief',
      description: 'Send a brief payload to connected LAN peers (optionally filtered by peer name)',
      inputSchema: {
        payload: z.unknown(),
        peers: z.array(z.string()).optional(),
      },
    },
    async ({ payload, peers }: { payload?: unknown; peers?: string[] }) => {
      const result = relay.shareBrief(payload, peers);
      return ok(result);
    },
  );

  ctx.server.registerTool(
    'broadcast_rule',
    {
      title: 'Broadcast Rule',
      description: 'Broadcast a rule (by id) to all connected LAN peers',
      inputSchema: {
        ruleId: z.string().min(1),
      },
    },
    async ({ ruleId }: { ruleId: string }) => {
      const rule = ctx.ruleManager?.get(ruleId);
      if (!rule) return err(`rule not found: ${ruleId}`);
      const result = await relay.broadcastRule(rule);
      return ok(result);
    },
  );
}
