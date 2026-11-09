/**
 * Y-05a — гейт `sqlite-vec`: проверка наличия и совместимости расширения.
 *
 * ADR-009: VectorProvider на SQLite возможен только после проверки `sqlite-vec` с текущей версией
 * Node и в Docker. Гейт не делает вид, что всё хорошо: он возвращает честный результат, а профиль
 * объявляет `vectors: false`, пока расширение не подтверждено. Пакет грузится лениво — SQLite-профиль
 * без векторных коллекций должен работать, даже если нативная зависимость не встала.
 */

import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import { StoreError } from '../../contracts.js';

export interface SqliteVecProbe {
  node: string;
  sqlite: string;
  fts5: boolean;
  vec: {
    available: boolean;
    version?: string;
    /** Path to the loadable extension when the npm package is present. */
    loadablePath?: string;
    error?: string;
  };
}

interface SqliteVecPackage {
  getLoadablePath(): string;
  load(db: Database.Database): void;
}

const requireFromHere = createRequire(import.meta.url);

function loadPackage(): SqliteVecPackage | null {
  try {
    return requireFromHere('sqlite-vec') as SqliteVecPackage;
  } catch {
    return null;
  }
}

/**
 * Probes SQLite and the `sqlite-vec` extension on the given connection. `vecPackage` is injectable so
 * a test can prove the "package missing" branch without uninstalling the dependency.
 */
export function probeSqliteVec(
  db: Database.Database,
  vecPackage?: SqliteVecPackage | null,
): SqliteVecProbe {
  const sqlite = String((db.prepare('select sqlite_version() as v').get() as { v: string }).v);
  const fts5 =
    Number((db.prepare("select sqlite_compileoption_used('ENABLE_FTS5') as used").get() as { used: number }).used) === 1;
  const probe: SqliteVecProbe = { node: process.version, sqlite, fts5, vec: { available: false } };

  const pkg = vecPackage === undefined ? loadPackage() : vecPackage;
  if (!pkg) {
    probe.vec = { available: false, error: 'sqlite-vec npm package is not installed' };
    return probe;
  }
  try {
    probe.vec.loadablePath = pkg.getLoadablePath();
    db.loadExtension(probe.vec.loadablePath);
    const row = db.prepare('select vec_version() as version').get() as { version: string };
    probe.vec = { available: true, version: row.version, loadablePath: probe.vec.loadablePath };
  } catch (error) {
    probe.vec = {
      available: false,
      loadablePath: probe.vec.loadablePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return probe;
}

/** Loads `sqlite-vec` or throws a domain error; vectors are optional in the SQLite profile. */
export function loadSqliteVecOrThrow(db: Database.Database): SqliteVecProbe {
  const probe = probeSqliteVec(db);
  if (!probe.vec.available) {
    throw new StoreError(
      'CAPABILITY_UNAVAILABLE',
      `sqlite-vec is unavailable: ${probe.vec.error ?? 'unknown error'}`,
    );
  }
  return probe;
}
