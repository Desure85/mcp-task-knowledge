/**
 * UI-33a — server profile tools.
 *
 * `profile_get` / `profile_set` store arbitrary small JSON preferences per
 * authenticated user (theme selection and custom themes live in there). Local
 * stdio has no user identity, so it uses the single `local` profile.
 */
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { ok, err } from '../utils/respond.js';
import { resolveExtraSessionId } from '../core/auth-gate.js';
import type { GateExtra } from '../core/auth-gate.js';
import { DATA_DIR } from '../config.js';
import { ProfileError, UserProfileStore } from '../profiles/store.js';

let store: UserProfileStore | undefined;

function profiles(): UserProfileStore {
  store ??= new UserProfileStore(DATA_DIR);
  return store;
}

function userIdOf(ctx: ServerContext, extra?: GateExtra): string {
  const sessionId = resolveExtraSessionId(extra);
  return (sessionId ? ctx.authManager?.getUserId(sessionId) : undefined) ?? 'local';
}

export function registerProfileTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'profile_get',
    {
      title: 'Get User Profile',
      description: 'Read the current user’s server-side preferences (theme, custom themes) and updatedAt.',
      inputSchema: {},
    },
    async (_args: Record<string, never>, extra?: GateExtra) => {
      const userId = userIdOf(ctx, extra);
      const profile = await profiles().get(userId);
      return ok({ userId, profile });
    },
  );

  ctx.server.registerTool(
    'profile_set',
    {
      title: 'Set User Profile',
      description:
        'Write the current user’s preferences. Last write wins by updatedAt; an older write returns conflict with the current profile; identical timestamps are idempotent duplicates.',
      inputSchema: {
        preferences: z.unknown(),
        updatedAt: z.string().min(1),
        clientId: z.string().max(120).optional(),
      },
    },
    async ({ preferences, updatedAt, clientId }: { preferences: unknown; updatedAt: string; clientId?: string }, extra?: GateExtra) => {
      const userId = userIdOf(ctx, extra);
      try {
        const result = await profiles().set(userId, preferences, updatedAt, clientId);
        return ok({ userId, ...result });
      } catch (error) {
        if (error instanceof ProfileError) return err(`${error.code}: ${error.message}`);
        return err((error as Error).message);
      }
    },
  );
}
