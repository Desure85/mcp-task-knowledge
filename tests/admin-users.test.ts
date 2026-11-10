import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import type { ServerContext } from '../src/register/context.js';
import { registerUsersTools } from '../src/register/users.js';
import { SqliteUserStore } from '../src/auth/user-store.js';
import { composeTokenValidators, createUserTokenValidator } from '../src/auth/user-token-validator.js';

const cleanup: Array<() => void> = [];

function store(): SqliteUserStore {
  const dir = fs.mkdtempSync(path.join(DATA_DIR, '.tmp-t01b-'));
  const instance = new SqliteUserStore(path.join(dir, 'auth.db'));
  cleanup.push(() => {
    instance.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return instance;
}

afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

type Handler = (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>;

function harness(userStore: SqliteUserStore, transportType = 'stdio', roles?: string[]) {
  const handlers = new Map<string, Handler>();
  const ctx = {
    server: {
      registerTool: (name: string, _def: unknown, handler: Handler) => handlers.set(name, handler),
    },
    userStore,
    transportType,
    ...(roles
      ? {
          authManager: {},
          sessionManager: { get: () => ({ metadata: { roles } }) },
        }
      : {}),
  } as unknown as ServerContext;
  registerUsersTools(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await handlers.get(name)!(args, { sessionId: 'sess-1' });
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    return JSON.parse(text) as { ok: boolean; data?: any; error?: { message: string } };
  };
  return { call, names: [...handlers.keys()] };
}

describe('T-01b: admin user/token tools', () => {
  it('registers the admin surface and lets local stdio manage users', async () => {
    const users = store();
    const { call, names } = harness(users);
    expect(names).toEqual(expect.arrayContaining([
      'admin_users_list', 'admin_user_create', 'admin_user_set_password',
      'admin_user_set_roles', 'admin_user_disable', 'admin_tokens_list',
      'admin_token_create', 'admin_token_revoke',
    ]));
    const created = await call('admin_user_create', { username: 'zoe', password: 'pw', roles: ['agent'] });
    expect(created.ok).toBe(true);
    const listed = await call('admin_users_list');
    expect(listed.ok).toBe(true);
    expect(listed.data.map((user: { username: string }) => user.username)).toContain('zoe');
    const updated = await call('admin_user_set_roles', { userId: created.data.id, roles: ['admin'] });
    expect(updated.ok).toBe(true);
    expect(users.getUser(created.data.id)?.roles).toEqual(['admin']);
  });

  it('creates a token once, never lists plaintext, and revokes it', async () => {
    const users = store();
    const user = users.createUser('yan', 'pw');
    const { call } = harness(users);
    const created = await call('admin_token_create', { userId: user.id, name: 'ci' });
    expect(created.ok).toBe(true);
    expect(created.data.token.startsWith('mtk_')).toBe(true);
    const listed = await call('admin_tokens_list', { userId: user.id });
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed.data)).not.toContain(created.data.token);
    const revoked = await call('admin_token_revoke', { userId: user.id, tokenId: created.data.record.id });
    expect(revoked.data.revoked).toBe(true);
    expect(users.verifyToken(created.data.token)).toBeNull();
  });

  it('denies non-admin sessions and surfaces store errors', async () => {
    const users = store();
    const nonAdmin = harness(users, 'http', ['agent']);
    const denied = await nonAdmin.call('admin_users_list');
    expect(denied.ok).toBe(false);
    expect(denied.error?.message).toMatch(/admin role required/);

    const admin = harness(users, 'http', ['admin']);
    const allowed = await admin.call('admin_users_list');
    expect(allowed.ok).toBe(true);

    const empty = harness(users, 'stdio');
    await expect(empty.call('admin_user_create', { username: 'x', password: 'y' })).resolves.toMatchObject({ ok: true });
  });

  it('reports a missing store instead of pretending success', async () => {
    const { call } = harness(undefined as unknown as SqliteUserStore);
    const result = await call('admin_users_list');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/user store is not configured/);
  });
});

describe('T-01b: personal tokens as TokenValidator', () => {
  it('validates a personal token, rejects after revoke, and composes with a fallback', async () => {
    const users = store();
    const user = users.createUser('vic', 'pw', ['agent']);
    const created = users.createToken(user.id, { name: 'laptop' });
    const validator = createUserTokenValidator(users);
    expect(await validator(created.token)).toMatchObject({ userId: user.id, roles: ['agent'] });
    expect(await validator('nope')).toBeNull();
    users.revokeToken(user.id, created.record.id);
    expect(await validator(created.token)).toBeNull();

    const fallback = composeTokenValidators(validator, async (token: string) =>
      token === 'legacy' ? { userId: 'legacy', roles: ['admin'] } : null,
    );
    expect(await fallback('legacy')).toMatchObject({ userId: 'legacy', roles: ['admin'] });
    expect(await fallback('unknown')).toBeNull();
  });
});
