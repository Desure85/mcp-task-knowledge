/**
 * T-01b: admin MCP tools for users and personal tokens.
 *
 * These tools require an admin role on authenticated transports; on local stdio the local process is
 * already trusted (same rule as the rest of the local-only surface) and the env admin bootstrap is
 * enough. Tokens are returned exactly once; lists expose only prefix/metadata.
 */

import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { ok, err } from '../utils/respond.js';
import { resolveExtraSessionId } from '../core/auth-gate.js';
import type { GateExtra } from '../core/auth-gate.js';

function adminDenied(ctx: ServerContext, extra?: GateExtra): string | null {
  if (!ctx.userStore) return 'user store is not configured (set JWT_SECRET or MCP_LOGIN_*)';
  if (ctx.transportType === 'stdio' && !ctx.authManager) return null;
  const sessionId = resolveExtraSessionId(extra);
  const roles = sessionId ? ctx.sessionManager?.get(sessionId)?.metadata?.roles : undefined;
  if (Array.isArray(roles) && roles.includes('admin')) return null;
  return 'access denied — admin role required';
}

function handle(ctx: ServerContext, extra: GateExtra | undefined, fn: () => unknown) {
  const denied = adminDenied(ctx, extra);
  if (denied) return err(denied);
  try {
    return ok(fn());
  } catch (error) {
    return err((error as Error).message);
  }
}

export function registerUsersTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'admin_users_list',
    {
      title: 'List users',
      description: 'List users from DATA_DIR/auth.db (admin only; hashes and tokens are never returned).',
      inputSchema: {},
    },
    async (_args: Record<string, unknown>, extra?: GateExtra) => handle(ctx, extra, () => ctx.userStore!.listUsers()),
  );

  ctx.server.registerTool(
    'admin_user_create',
    {
      title: 'Create user',
      description: 'Create a user with a scrypt-hashed password (admin only).',
      inputSchema: {
        username: z.string().min(1),
        password: z.string().min(1),
        roles: z.array(z.string()).optional(),
      },
    },
    async ({ username, password, roles }: { username: string; password: string; roles?: string[] }, extra?: GateExtra) =>
      handle(ctx, extra, () => ctx.userStore!.createUser(username, password, roles ?? [])),
  );

  ctx.server.registerTool(
    'admin_user_set_password',
    {
      title: 'Set user password',
      description: 'Replace a user password (admin only); existing personal tokens are revoked.',
      inputSchema: { userId: z.string().min(1), password: z.string().min(1) },
    },
    async ({ userId, password }: { userId: string; password: string }, extra?: GateExtra) =>
      handle(ctx, extra, () => {
        ctx.userStore!.setPassword(userId, password);
        return { updated: true };
      }),
  );

  ctx.server.registerTool(
    'admin_user_set_roles',
    {
      title: 'Set user roles',
      description: 'Replace a user roles array (admin only).',
      inputSchema: { userId: z.string().min(1), roles: z.array(z.string()) },
    },
    async ({ userId, roles }: { userId: string; roles: string[] }, extra?: GateExtra) =>
      handle(ctx, extra, () => {
        ctx.userStore!.setRoles(userId, roles);
        return { updated: true };
      }),
  );

  ctx.server.registerTool(
    'admin_user_disable',
    {
      title: 'Disable/enable user',
      description: 'Disable a user (blocks password login and personal tokens) or enable it again.',
      inputSchema: { userId: z.string().min(1), disabled: z.boolean() },
    },
    async ({ userId, disabled }: { userId: string; disabled: boolean }, extra?: GateExtra) =>
      handle(ctx, extra, () => {
        ctx.userStore!.setDisabled(userId, disabled);
        return { updated: true };
      }),
  );

  ctx.server.registerTool(
    'admin_tokens_list',
    {
      title: 'List personal tokens',
      description: 'List a user personal tokens (prefix/metadata only; never the raw token).',
      inputSchema: { userId: z.string().min(1) },
    },
    async ({ userId }: { userId: string }, extra?: GateExtra) => handle(ctx, extra, () => ctx.userStore!.listTokens(userId)),
  );

  ctx.server.registerTool(
    'admin_token_create',
    {
      title: 'Create personal token',
      description:
        'Mint a personal access token for a user (admin only). The raw token is returned exactly once and never stored in plaintext.',
      inputSchema: {
        userId: z.string().min(1),
        name: z.string().min(1).optional(),
        expiresAt: z.string().datetime().optional(),
      },
    },
    async (
      { userId, name, expiresAt }: { userId: string; name?: string; expiresAt?: string },
      extra?: GateExtra,
    ) =>
      handle(ctx, extra, () => ctx.userStore!.createToken(userId, { ...(name ? { name } : {}), ...(expiresAt ? { expiresAt } : {}) })),
  );

  ctx.server.registerTool(
    'admin_token_revoke',
    {
      title: 'Revoke personal token',
      description: 'Revoke one personal token by id (admin only).',
      inputSchema: { userId: z.string().min(1), tokenId: z.string().min(1) },
    },
    async ({ userId, tokenId }: { userId: string; tokenId: string }, extra?: GateExtra) =>
      handle(ctx, extra, () => ({ revoked: ctx.userStore!.revokeToken(userId, tokenId) })),
  );
}
