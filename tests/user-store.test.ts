import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import { SqliteUserStore, ensureBootstrapAdmin } from '../src/auth/user-store.js';
import { createLoginHandler } from '../src/transport/login-route.js';

const cleanup: Array<() => void> = [];

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(DATA_DIR, '.tmp-t01-user-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'auth.db');
}

function store(): SqliteUserStore {
  const instance = new SqliteUserStore(tempDb());
  cleanup.push(() => instance.close());
  return instance;
}

afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

describe('T-01a: users and scrypt passwords', () => {
  it('creates users, hashes passwords and authenticates without plaintext', () => {
    const users = store();
    const created = users.createUser('alice', 'correct horse', ['admin', 'agent']);
    expect(created.username).toBe('alice');
    expect(created.roles).toEqual(['admin', 'agent']);
    expect(users.authenticate('alice', 'correct horse')).toEqual({
      userId: created.id,
      username: 'alice',
      roles: ['admin', 'agent'],
    });
    expect(users.authenticate('alice', 'wrong')).toBeNull();
    expect(users.authenticate('nobody', 'wrong')).toBeNull();
    expect(users.authenticate('nobody', 'correct horse')).toBeNull();
  });

  it('stores a scrypt hash, never plaintext, and changes password invalidates tokens', () => {
    const dbPath = tempDb();
    const users = new SqliteUserStore(dbPath);
    cleanup.push(() => users.close());
    const user = users.createUser('bob', 'old-password', ['agent']);
    const raw = new Database(dbPath, { readonly: true });
    const row = raw.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    raw.close();
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('old-password');

    const token = users.createToken(user.id, { name: 'laptop' });
    expect(users.verifyToken(token.token)?.userId).toBe(user.id);
    users.setPassword(user.id, 'new-password');
    expect(users.authenticate('bob', 'old-password')).toBeNull();
    expect(users.authenticate('bob', 'new-password')?.userId).toBe(user.id);
    expect(users.verifyToken(token.token)).toBeNull(); // password change revokes tokens
  });

  it('enforces roles, disabled users and unique usernames', () => {
    const users = store();
    const user = users.createUser('carol', 'pw', ['agent']);
    expect(() => users.createUser('carol', 'other')).toThrow(/already exists/);
    users.setRoles(user.id, ['admin']);
    expect(users.getUser(user.id)?.roles).toEqual(['admin']);
    users.setDisabled(user.id, true);
    expect(users.authenticate('carol', 'pw')).toBeNull();
    expect(users.getUserByUsername('carol')?.disabled).toBe(true);
  });

  it('creates personal tokens once, lists only prefixes, and verifies/revokes them', () => {
    const users = store();
    const user = users.createUser('dave', 'pw');
    const first = users.createToken(user.id, { name: 'ci' });
    expect(first.token.startsWith('mtk_')).toBe(true);
    expect(first.record.prefix).toBe(first.token.slice(0, 12));
    const listed = users.listTokens(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('token');
    expect(JSON.stringify(listed)).not.toContain(first.token);
    expect(users.verifyToken(first.token)?.userId).toBe(user.id);
    expect(users.revokeToken(user.id, first.record.id)).toBe(true);
    expect(users.verifyToken(first.token)).toBeNull();
    expect(users.revokeToken(user.id, first.record.id)).toBe(false);
    expect(users.verifyToken('mtk_unknown')).toBeNull();
  });

  it('rejects expired tokens and tokens of disabled users', () => {
    const users = store();
    const user = users.createUser('erin', 'pw');
    const expired = users.createToken(user.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(users.verifyToken(expired.token)).toBeNull();
    const valid = users.createToken(user.id);
    users.setDisabled(user.id, true);
    expect(users.verifyToken(valid.token)).toBeNull();
  });

  it('bootstraps the env admin only when missing, without overwriting a password', () => {
    const users = store();
    const env = { MCP_LOGIN_USER: 'root', MCP_LOGIN_PASSWORD: 'bootstrap-secret' };
    expect(ensureBootstrapAdmin(users, env)).toEqual({ created: true, username: 'root' });
    expect(users.authenticate('root', 'bootstrap-secret')?.roles).toEqual(['admin']);
    expect(ensureBootstrapAdmin(users, { ...env, MCP_LOGIN_PASSWORD: 'different' })).toEqual({
      created: false,
      username: 'root',
    });
    expect(users.authenticate('root', 'bootstrap-secret')?.userId).toBeTruthy();
    expect(users.authenticate('root', 'different')).toBeNull();
  });
});

describe('T-01a: /auth/login uses the store', () => {
  let server: Server | undefined;
  const saved = { JWT_SECRET: process.env.JWT_SECRET, MCP_LOGIN_USER: process.env.MCP_LOGIN_USER, MCP_LOGIN_PASSWORD: process.env.MCP_LOGIN_PASSWORD };

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const current = server;
    server = undefined;
    if (current) {
      current.closeAllConnections?.();
      await new Promise<void>((resolve) => current.close(() => resolve()));
    }
  });

  async function login(handler: ReturnType<typeof createLoginHandler>, body: object): Promise<Response> {
    const current = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => current.listen(0, '127.0.0.1', () => resolve()));
    const port = (current.address() as AddressInfo).port;
    try {
      return await fetch(`http://127.0.0.1:${port}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } finally {
      current.closeAllConnections?.();
      await new Promise<void>((resolve) => current.close(() => resolve()));
    }
  }

  it('issues a JWT with the store roles and rejects wrong/unknown users generically', async () => {
    const users = store();
    const frank = users.createUser('frank', 'store-password', ['agent']);
    process.env.JWT_SECRET = 't01-secret';
    delete process.env.MCP_LOGIN_USER;
    delete process.env.MCP_LOGIN_PASSWORD;
    const handler = createLoginHandler({ userStore: users });

    const ok = await login(handler, { username: 'frank', password: 'store-password' });
    expect(ok.status).toBe(200);
    const payload = await ok.json() as { token: string; user: { id: string; roles: string[] } };
    expect(payload.user).toEqual({ id: frank.id, roles: ['agent'] });
    expect(payload.token.split('.')).toHaveLength(3);

    const wrong = await login(handler, { username: 'frank', password: 'nope' });
    const unknown = await login(handler, { username: 'nobody', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const wrongBody = await wrong.json() as { error: { message: string } };
    const unknownBody = await unknown.json() as { error: { message: string } };
    expect(wrongBody).toEqual(unknownBody);
    expect(wrongBody.error.message).toBe('Invalid username or password');
  });

  it('keeps the env admin as bootstrap when a store is present', async () => {
    const users = store();
    process.env.JWT_SECRET = 't01-secret';
    process.env.MCP_LOGIN_USER = 'legacy-admin';
    process.env.MCP_LOGIN_PASSWORD = 'legacy-password';
    const handler = createLoginHandler({ userStore: users });
    const response = await login(handler, { username: 'legacy-admin', password: 'legacy-password' });
    expect(response.status).toBe(200);
    const payload = await response.json() as { user: { id: string; roles: string[] } };
    expect(payload.user).toEqual({ id: 'legacy-admin', roles: ['admin'] });
  });
});
