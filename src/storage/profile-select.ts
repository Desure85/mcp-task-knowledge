/**
 * Y-05a — выбор профиля хранилища.
 *
 * `STORAGE_PROFILE` решает, какой профиль создаёт точка сборки: `file` (по умолчанию, поведение не
 * меняется) или `sqlite`. Неизвестное значение — `StoreError('CONFIG_MISMATCH')`, а не молчаливый
 * откат на файловый профиль: тихо обслуживать чужой формат хуже, чем упасть на старте.
 */

import type { StorageProfile } from './contracts.js';
import { StoreError } from './contracts.js';
import { createFileProfile, type FileProfileOptions } from './profiles/file/index.js';
import { createSqliteProfile } from './profiles/sqlite/index.js';

export type StorageProfileKind = 'file' | 'sqlite';

export function readStorageProfileKind(env: NodeJS.ProcessEnv = process.env): StorageProfileKind {
  const raw = (env.STORAGE_PROFILE ?? 'file').trim().toLowerCase();
  if (raw === 'file' || raw === 'sqlite') return raw;
  throw new StoreError(
    'CONFIG_MISMATCH',
    `unknown STORAGE_PROFILE="${raw}"; expected "file" or "sqlite"`,
  );
}

export interface StorageProfileSelection extends FileProfileOptions {
  kind?: StorageProfileKind;
  /** SQLite database file; required for the sqlite profile (caller owns the path, ADR-009 rule 1). */
  databasePath?: string;
}

export function createStorageProfile(selection: StorageProfileSelection = {}): StorageProfile {
  const kind = selection.kind ?? readStorageProfileKind();
  if (kind === 'sqlite') {
    if (!selection.databasePath) {
      throw new StoreError('CONFIG_MISMATCH', 'sqlite profile requires databasePath');
    }
    return createSqliteProfile({ databasePath: selection.databasePath });
  }
  const fileOptions: FileProfileOptions = {
    tasksDir: selection.tasksDir,
    knowledgeDir: selection.knowledgeDir,
    vectorsDir: selection.vectorsDir,
    embeddingProvider: selection.embeddingProvider,
    indexingManifestPath: selection.indexingManifestPath,
    externalPolicy: selection.externalPolicy,
  };
  return createFileProfile(fileOptions);
}
