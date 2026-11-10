/**
 * Gate §5.6 (этап Y): `doctor` показывает активный профиль, его манифест и возможности, а не
 * «предполагаемые». Инспекция не должна создавать хранилище побочным эффектом, поэтому отсутствующая
 * SQLite-БД и недоступный Postgres репортятся как ошибка/предупреждение, а не инициализируются.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createFileProfile } from '../storage/profiles/file/index.js';
import { createSqliteProfile } from '../storage/profiles/sqlite/index.js';
import { createPostgresProfile } from '../storage/profiles/postgres/index.js';
import type { StorageProfile } from '../storage/contracts.js';

export interface StorageProfileSummary {
  /** `file`, `sqlite`, `postgres` or the raw unknown value from the env. */
  profile: string;
  roots: { tasks?: string; knowledge?: string };
  collections: string[];
  capabilities: Record<string, boolean>;
  /** Present when the profile could not be inspected (missing DB, unreachable Postgres, …). */
  error?: string;
}

function summarize(profile: string, storage: StorageProfile): StorageProfileSummary {
  return {
    profile,
    roots: storage.manifest.roots,
    collections: [...storage.manifest.collections].sort(),
    capabilities: storage.manifest.capabilities as unknown as Record<string, boolean>,
  };
}

export async function inspectActiveStorageProfile(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StorageProfileSummary> {
  const raw = (env.STORAGE_PROFILE ?? 'file').trim();
  const kind = raw.toLowerCase();
  if (kind === 'file') {
    return summarize('file', createFileProfile());
  }
  if (kind === 'sqlite') {
    const databasePath = path.join(dataDir, '.index', 'storage.sqlite');
    if (!fs.existsSync(databasePath)) {
      return {
        profile: 'sqlite',
        roots: {},
        collections: [],
        capabilities: {},
        error: `SQLite database not found: ${databasePath}`,
      };
    }
    const storage = createSqliteProfile({ databasePath });
    try {
      return summarize('sqlite', storage);
    } finally {
      storage.close?.();
    }
  }
  if (kind === 'postgres') {
    const connectionString = env.POSTGRES_URL?.trim();
    if (!connectionString) {
      return {
        profile: 'postgres',
        roots: {},
        collections: [],
        capabilities: {},
        error: 'POSTGRES_URL is not set',
      };
    }
    try {
      const storage = await createPostgresProfile({ connectionString, manageExtensions: false });
      try {
        return summarize('postgres', storage);
      } finally {
        storage.close?.();
      }
    } catch (error) {
      return {
        profile: 'postgres',
        roots: {},
        collections: [],
        capabilities: {},
        error: (error as Error).message,
      };
    }
  }
  return {
    profile: raw,
    roots: {},
    collections: [],
    capabilities: {},
    error: `unknown STORAGE_PROFILE: ${raw}`,
  };
}
