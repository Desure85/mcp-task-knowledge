/**
 * Y-02e: composition-root factory for the storage profile. Registrators must not import
 * `src/storage/**` directly; they receive the profile through `ServerContext`. This module is
 * outside `src/register/**` so the guard can enforce that boundary.
 */
import path from 'node:path';
import { createFileProfile } from '../storage/profiles/file/index.js';
import { createSqliteProfile } from '../storage/profiles/sqlite/index.js';
import { createPostgresProfile } from '../storage/profiles/postgres/index.js';
import { readStorageProfileKind } from '../storage/profile-select.js';
import { StoreError, type StorageProfile } from '../storage/contracts.js';

export type { StorageProfile } from '../storage/contracts.js';

type FileProfileOptions = NonNullable<Parameters<typeof createFileProfile>[0]>;
export type StorageExternalPolicy = FileProfileOptions['externalPolicy'];
export type StorageEmbeddingProvider = FileProfileOptions['embeddingProvider'];

export interface CreateStorageProfileOptions {
  dataDir: string;
  embeddingProvider: StorageEmbeddingProvider;
  externalPolicy: StorageExternalPolicy;
  postgresUrl?: string;
  blobsDir?: string;
}

/** Y-05a: STORAGE_PROFILE picks the implementation behind the same contracts. */
export async function createStorageProfile(options: CreateStorageProfileOptions): Promise<StorageProfile> {
  const kind = readStorageProfileKind();
  if (kind === 'postgres') {
    try {
      return await createPostgresProfile({
        connectionString: options.postgresUrl ?? '',
        embeddingProvider: options.embeddingProvider,
        externalPolicy: options.externalPolicy,
        ...(options.blobsDir ? { blobsDir: options.blobsDir } : {}),
      });
    } catch (error) {
      throw error instanceof StoreError
        ? error
        : new StoreError('CONFIG_MISMATCH', `postgres profile failed to open: ${(error as Error).message}`, {
            hint: 'set POSTGRES_URL to a reachable PostgreSQL connection string',
          });
    }
  }
  if (kind === 'sqlite') {
    return createSqliteProfile({
      databasePath: path.join(options.dataDir, '.index', 'storage.sqlite'),
      embeddingProvider: options.embeddingProvider,
      externalPolicy: options.externalPolicy,
    });
  }
  return createFileProfile({
    externalPolicy: options.externalPolicy,
    embeddingProvider: options.embeddingProvider,
  });
}
