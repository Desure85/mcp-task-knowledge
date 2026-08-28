/**
 * core/secret-manager.ts — Secret management (SEC-004).
 *
 * Provides secure storage and retrieval of secrets (API keys, tokens, etc.).
 * Supports multiple backends:
 *   - Environment variables (default, no encryption)
 *   - File-based encrypted storage (AES-256-GCM)
 *   - Docker secrets (read from /run/secrets/)
 *   - HashiCorp Vault (optional, future — interface only)
 *
 * Encryption:
 *   File backend uses AES-256-GCM with a master key derived from
 *   SECRET_MASTER_KEY env var or a randomly generated key (per-process).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from './logger.js';

const log = childLogger('secret-manager');

// ─── Types ────────────────────────────────────────────────────────

export type SecretBackend = 'env' | 'file' | 'docker' | 'vault';

export interface SecretManagerOptions {
  backend?: SecretBackend;
  filePath?: string;
  masterKey?: string;
  dockerSecretsDir?: string;
  vaultUrl?: string;
  vaultToken?: string;
}

export interface SecretMetadata {
  key: string;
  backend: SecretBackend;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Encryption Helpers ───────────────────────────────────────────

const SALT = 'mcp-task-knowledge-salt-v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function deriveKey(masterKey: string): Buffer {
  return scryptSync(masterKey, SALT, KEY_LENGTH);
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('invalid ciphertext format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

interface FileStorage {
  [key: string]: { value: string; createdAt: string; updatedAt: string };
}

// ─── SecretManager ────────────────────────────────────────────────

export class SecretManager {
  private readonly backend: SecretBackend;
  private readonly filePath: string;
  private readonly key: Buffer;
  private readonly dockerSecretsDir: string;
  private fileCache: FileStorage | undefined;

  constructor(options?: SecretManagerOptions) {
    this.backend = options?.backend ?? 'env';
    this.filePath = options?.filePath ?? './secrets.enc.json';
    this.dockerSecretsDir = options?.dockerSecretsDir ?? '/run/secrets';

    const masterKey = options?.masterKey ?? process.env.SECRET_MASTER_KEY ?? randomBytes(32).toString('hex');
    this.key = deriveKey(masterKey);

    if (this.backend === 'file') {
      const dir = dirname(this.filePath);
      try { mkdirSync(dir, { recursive: true }); } catch { /* may already exist */ }
    }
  }

  async get(key: string): Promise<string | undefined> {
    switch (this.backend) {
      case 'env': return process.env[key];
      case 'file': return this.getFile(key);
      case 'docker': return this.getDocker(key);
      case 'vault': log.warn('vault backend not yet implemented'); return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    switch (this.backend) {
      case 'file': return this.setFile(key, value);
      case 'env': throw new Error('cannot set env vars at runtime — set before process start');
      case 'docker': throw new Error('cannot set Docker secrets at runtime — mount via docker-compose');
      case 'vault': throw new Error('vault backend not yet implemented');
    }
  }

  async delete(key: string): Promise<boolean> {
    switch (this.backend) {
      case 'file': return this.deleteFile(key);
      default: throw new Error(`delete not supported for ${this.backend} backend`);
    }
  }

  async list(): Promise<SecretMetadata[]> {
    switch (this.backend) {
      case 'env': {
        const secretPattern = /(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)/i;
        return Object.keys(process.env)
          .filter((k) => secretPattern.test(k))
          .map((k) => ({ key: k, backend: 'env' as const }));
      }
      case 'file': {
        const storage = this.loadFile();
        return Object.keys(storage).map((k) => ({
          key: k, backend: 'file' as const,
          createdAt: storage[k].createdAt, updatedAt: storage[k].updatedAt,
        }));
      }
      case 'docker': {
        try {
          return readdirSync(this.dockerSecretsDir)
            .map((k) => ({ key: k, backend: 'docker' as const }));
        } catch { return []; }
      }
      case 'vault': return [];
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  get currentBackend(): SecretBackend { return this.backend; }

  // ─── File Backend ───────────────────────────────────────────────

  private loadFile(): FileStorage {
    if (this.fileCache) return this.fileCache;
    try {
      if (existsSync(this.filePath)) {
        this.fileCache = JSON.parse(readFileSync(this.filePath, 'utf8')) as FileStorage;
      } else { this.fileCache = {}; }
    } catch (err) { log.error({ err }, 'failed to load secret file'); this.fileCache = {}; }
    return this.fileCache;
  }

  private saveFile(): void {
    if (!this.fileCache) return;
    try { writeFileSync(this.filePath, JSON.stringify(this.fileCache, null, 2), 'utf8'); }
    catch (err) { log.error({ err }, 'failed to save secret file'); }
  }

  private getFile(key: string): string | undefined {
    const entry = this.loadFile()[key];
    if (!entry) return undefined;
    try { return decrypt(entry.value, this.key); }
    catch (err) { log.error({ key, err }, 'failed to decrypt secret'); return undefined; }
  }

  private setFile(key: string, value: string): void {
    const storage = this.loadFile();
    const now = new Date().toISOString();
    storage[key] = {
      value: encrypt(value, this.key),
      createdAt: storage[key]?.createdAt ?? now,
      updatedAt: now,
    };
    this.saveFile();
    log.info({ key }, 'secret stored');
  }

  private deleteFile(key: string): boolean {
    const storage = this.loadFile();
    if (!storage[key]) return false;
    delete storage[key];
    this.saveFile();
    log.info({ key }, 'secret deleted');
    return true;
  }

  // ─── Docker Backend ─────────────────────────────────────────────

  private getDocker(key: string): string | undefined {
    try {
      const path = join(this.dockerSecretsDir, key);
      if (!existsSync(path)) return undefined;
      return readFileSync(path, 'utf8').trim();
    } catch { return undefined; }
  }
}

export function createSecretManager(): SecretManager {
  const backend = (process.env.SECRET_BACKEND ?? 'env') as SecretBackend;
  return new SecretManager({
    backend,
    filePath: process.env.SECRET_FILE_PATH ?? './secrets.enc.json',
    masterKey: process.env.SECRET_MASTER_KEY,
    dockerSecretsDir: process.env.DOCKER_SECRETS_DIR ?? '/run/secrets',
  });
}
