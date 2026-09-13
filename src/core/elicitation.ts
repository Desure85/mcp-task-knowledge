/**
 * TR-12: MCP elicitation helper for destructive-op confirmation.
 *
 * When a destructive tool is called without `confirm: true`, we try to ask the
 * end user directly via the MCP `elicitation/create` request instead of
 * blindly refusing. Clients that don't declare the `elicitation` capability
 * (or where the request fails) fall back to the previous refusal envelope —
 * fail-safe: anything but an explicit accept is treated as "not confirmed".
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { childLogger } from './logger.js';

const log = childLogger('elicitation');

export type ElicitConfirmResult = 'accepted' | 'declined' | 'unsupported' | 'error';

interface ElicitCapableServer {
  getClientCapabilities(): { elicitation?: unknown } | undefined;
  elicitInput(params: unknown): Promise<{ action: string; content?: Record<string, unknown> }>;
}

/**
 * Ask the user to confirm a destructive operation via MCP elicitation.
 *
 * @param ctx     ServerContext-shaped object — only `ctx.server` is used.
 * @param message Human-readable prompt shown by the client (include counts).
 * @returns 'accepted'    — user explicitly confirmed (action=accept, confirm=true)
 *          'declined'    — user declined/cancelled, or accepted without confirm=true
 *          'unsupported' — client did not declare the elicitation capability
 *          'error'       — elicitation request threw (treated as declined upstream)
 */
export async function elicitConfirm(
  ctx: { server: McpServer },
  message: string,
): Promise<ElicitConfirmResult> {
  const server = ctx.server.server as unknown as ElicitCapableServer;

  let caps: { elicitation?: unknown } | undefined;
  try {
    caps = server.getClientCapabilities();
  } catch (e) {
    log.warn({ err: e }, 'getClientCapabilities threw — treating elicitation as unsupported');
    return 'error';
  }
  if (!caps?.elicitation) {
    return 'unsupported';
  }

  try {
    const result = await server.elicitInput({
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: 'Confirm',
            description: 'Set to true to confirm the destructive operation',
          },
        },
        required: ['confirm'],
      },
    });

    if (result.action === 'accept') {
      return result.content?.confirm === true ? 'accepted' : 'declined';
    }
    // 'decline' | 'cancel'
    return 'declined';
  } catch (e) {
    log.warn({ err: e }, 'elicitation request failed — treating as not confirmed');
    return 'error';
  }
}
