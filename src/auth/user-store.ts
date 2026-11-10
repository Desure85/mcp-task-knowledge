/**
 * T-01a: SQLite-backed users, scrypt password hashes and personal access tokens.
 *
 * The store is deliberately an interface (`UserStore`) so a future storage profile can replace the
 * SQLite implementation. It is a leaf module: callers pass the `auth.db` path, nothing imports
 * `config.ts` here. Secrets are never returned by list methods; token plaintext exists only in the
 * result of `createToken`.
 */

import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export interface UserRecord {
  id: string;
  username: string;
  roles: string[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserTokenRecord {
  id: string;
  userId: string;
  name: string;
  /** Non-secret prefix for display; the raw token is shown once on creation. */
  prefix: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
  roles: string[];
}

export interface CreatedToken {
  record: UserTokenRecord;
  /** Raw bearer token — returned exactly once and never stored in plaintext. */
  token: string;
}

export interface UserStore {
  createUser(username: string, password: string, roles?: string[]): UserRecord;
  listUsers(): UserRecord[];
  getUser(id: string): UserRecord | undefined;
  getUserByUsername(username: string): UserRecord | undefined;
  setPassword(userId: string, password: string): void;
  setRoles(userId: string, roles: string[]): void;
  setDisabled(userId: string, disabled: boolean): void;
  /** Constant-work check: unknown users and wrong passwords return null with the same shape. */
  authenticate(username: string, password: string): AuthenticatedUser | null;
  createToken(userId: string, options?: { name?: string; expiresAt?: string }): CreatedToken;
  listTokens(userId: string): UserTokenRecord[];
  revokeToken(userId: string, tokenId: string): boolean;
  revokeAllTokens(userId: string): number;
  verifyToken(rawToken: string): AuthenticatedUser | null;
  close(): void;
}

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = scrypt(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyHash(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function isoNow(): string {
  return new Date().toISOString();
}

const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-unknown-users');

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  roles: string;
  disabled: number;
  created_at: string;
  updated_at: string;
}

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

function rowToUser(row: UserRow): UserRecord {
  let roles: string[] = [];
  try {
    const parsed = JSON.parse(row.roles) as unknown;
    if (Array.isArray(parsed)) roles = parsed.filter((role): role is string => typeof role === 'string');
  } catch {
    roles = [];
  }
  return {
    id: row.id,
    username: row.username,
    roles,
    disabled: row.disabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToToken(row: TokenRow): UserTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
  };
}

/** SQLite `auth.db` implementation of `UserStore`. */
export class SqliteUserStore implements UserStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roles TEXT NOT NULL DEFAULT '[]',
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_tokens_hash ON user_tokens(token_hash);
    `);
  }

  createUser(username: string, password: string, roles: string[] = []): UserRecord {
    const normalized = username.trim();
    if (!normalized) throw new Error('username is required');
    if (!password) throw new Error('password is required');
    const now = isoNow();
    const id = crypto.randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO users (id, username, password_hash, roles, disabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(id, normalized, hashPassword(password), JSON.stringify(roles), now, now);
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error(`user already exists: ${normalized}`);
      }
      throw error;
    }
    return this.getUser(id)!;
  }

  listUsers(): UserRecord[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY username').all() as UserRow[];
    return rows.map(rowToUser);
  }

  getUser(id: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  getUserByUsername(username: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  setPassword(userId: string, password: string): void {
    if (!password) throw new Error('password is required');
    const result = this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(password), isoNow(), userId);
    if (result.changes === 0) throw new Error(`user not found: ${userId}`);
    // A password change invalidates existing personal tokens: they were issued under the old secret.
    this.revokeAllTokens(userId);
  }

  setRoles(userId: string, roles: string[]): void {
    const result = this.db
      .prepare('UPDATE users SET roles = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(roles), isoNow(), userId);
    if (result.changes === 0) throw new Error(`user not found: ${userId}`);
  }

  setDisabled(userId: string, disabled: boolean): void {
    const result = this.db
      .prepare('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?')
      .run(disabled ? 1 : 0, isoNow(), userId);
    if (result.changes === 0) throw new Error(`user not found: ${userId}`);
  }

  authenticate(username: string, password: string): AuthenticatedUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
    // Always run scrypt, including for unknown users, so timing does not reveal existence.
    const encoded = row?.password_hash ?? DUMMY_PASSWORD_HASH;
    const matches = verifyHash(password, encoded);
    if (!row || !matches || row.disabled !== 0) return null;
    return { userId: row.id, username: row.username, roles: rowToUser(row).roles };
  }

  createToken(userId: string, options: { name?: string; expiresAt?: string } = {}): CreatedToken {
    const user = this.getUser(userId);
    if (!user) throw new Error(`user not found: ${userId}`);
    if (options.expiresAt && Number.isNaN(Date.parse(options.expiresAt))) {
      throw new Error('expiresAt must be an ISO timestamp');
    }
    const raw = `mtk_${crypto.randomBytes(32).toString('base64url')}`;
    const now = isoNow();
    const id = crypto.randomUUID();
    const record: UserTokenRecord = {
      id,
      userId,
      name: options.name?.trim() || 'personal token',
      prefix: raw.slice(0, 12),
      createdAt: now,
      ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    };
    this.db
      .prepare(
        `INSERT INTO user_tokens (id, user_id, name, token_hash, prefix, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, record.name, sha256(raw), record.prefix, now, options.expiresAt ?? null);
    return { record, token: raw };
  }

  listTokens(userId: string): UserTokenRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM user_tokens WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as TokenRow[];
    return rows.map(rowToToken);
  }

  revokeToken(userId: string, tokenId: string): boolean {
    const result = this.db
      .prepare('UPDATE user_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
      .run(isoNow(), tokenId, userId);
    return result.changes > 0;
  }

  revokeAllTokens(userId: string): number {
    const result = this.db
      .prepare('UPDATE user_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(isoNow(), userId);
    return result.changes;
  }

  verifyToken(rawToken: string): AuthenticatedUser | null {
    if (!rawToken) return null;
    const row = this.db.prepare('SELECT * FROM user_tokens WHERE token_hash = ?').get(sha256(rawToken)) as TokenRow | undefined;
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
    const user = this.getUser(row.user_id);
    if (!user || user.disabled) return null;
    this.db.prepare('UPDATE user_tokens SET last_used_at = ? WHERE id = ?').run(isoNow(), row.id);
    return { userId: user.id, username: user.username, roles: user.roles };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Keep `MCP_LOGIN_USER`/`MCP_LOGIN_PASSWORD` as a bootstrap: create the admin once if the store has
 * no such user. Never overwrite an existing password silently.
 */
export function ensureBootstrapAdmin(
  store: UserStore,
  env: NodeJS.ProcessEnv = process.env,
): { created: boolean; username?: string } {
  const username = (env.MCP_LOGIN_USER ?? '').trim();
  const password = env.MCP_LOGIN_PASSWORD ?? '';
  if (!username || !password) return { created: false };
  if (store.getUserByUsername(username)) return { created: false, username };
  store.createUser(username, password, ['admin']);
  return { created: true, username };
}
