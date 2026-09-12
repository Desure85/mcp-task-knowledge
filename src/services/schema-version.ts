/**
 * schema-version.ts — DATA_DIR schema manifest + file-level migrations (DX-18).
 *
 * Problem: upgrading the package can silently mis-read data written by an
 * older layout (task JSON shape, frontmatter fields, directory layout).
 * This module stamps `DATA_DIR/.schema-version` and runs registered
 * file-level migrations at startup when the on-disk schema is older.
 *
 * Manifest shape (JSON, atomic write via writeJson):
 *   { "schema": <int>, "updatedAt": <iso>, "updatedBy": <pkg-version> }
 *
 * Semantics:
 *   - manifest missing + DATA_DIR empty      → fresh install: stamp CURRENT_SCHEMA
 *   - manifest missing + DATA_DIR non-empty  → legacy schema 0: migrate → stamp
 *   - manifest.schema < CURRENT_SCHEMA       → run migrations (from→to steps)
 *   - manifest.schema > CURRENT_SCHEMA       → REFUSE to boot (SchemaVersionError)
 *   - equal                                  → no-op
 *
 * NOTE: this is deliberately NOT the SQLite MigrationFramework
 * (src/db/migration-framework.ts) — that one is dead code built for
 * better-sqlite3 `_migrations` tables and does not fit file-based DATA_DIR.
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { pathExists, writeJson, readJson } from '../fs.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('schema-version');

/**
 * Resolve the running package version for the manifest's `updatedBy` field.
 * Same lookup order as register/setup.ts: npm_package_version env →
 * package.json two levels above this module → '0.0.0'.
 */
export async function getPackageVersion(): Promise<string> {
  const vEnv = process.env.npm_package_version;
  if (vEnv && typeof vEnv === 'string') return vEnv;
  try {
    const hereDir = path.dirname(new URL(import.meta.url).pathname);
    const repoRoot = path.resolve(hereDir, '..', '..');
    const raw = await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Current on-disk schema version this build understands. */
export const CURRENT_SCHEMA = 1;

/** Manifest filename inside DATA_DIR. */
export const SCHEMA_MANIFEST_FILE = '.schema-version';

export interface SchemaManifest {
  schema: number;
  updatedAt: string;
  updatedBy: string;
}

export interface SchemaMigration {
  /** Schema version the data is at BEFORE this migration. */
  from: number;
  /** Schema version after this migration completes. */
  to: number;
  /** Human-readable description for logs. */
  description: string;
  /** Perform the migration. `paths` carries resolved dirs. */
  migrate(paths: SchemaMigrationPaths): Promise<void>;
}

export interface SchemaMigrationPaths {
  dataDir: string;
  tasksDir: string;
  knowledgeDir: string;
}

/** Thrown when DATA_DIR was written by a NEWER package than this build. */
export class SchemaVersionError extends Error {
  constructor(
    message: string,
    readonly found: number,
    readonly supported: number,
  ) {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

/**
 * Registered migrations, ordered by `from`. Each step migrates exactly one
 * version (N → N+1); checkSchemaVersion applies them in sequence.
 *
 * v0→v1: the current layout (tasks/<project>/<id>.json,
 * knowledge/<project>/<id>.md with frontmatter id/project) is already what
 * schema 1 means — there is no concrete field reshape to perform. The
 * migration therefore only stamps the manifest; legacy flat-layout files
 * keep working through the existing fallback paths (pickDir / doctor
 * --fix handles derivable id/project). A no-op step is intentional: it
 * establishes the manifest so FUTURE schema bumps have a baseline.
 */
export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    from: 0,
    to: 1,
    description: 'baseline: stamp manifest for existing layout (no reshape needed)',
    async migrate() {
      // no-op — see comment above
    },
  },
];

function manifestPath(dataDir: string): string {
  return path.join(dataDir, SCHEMA_MANIFEST_FILE);
}

/** Read the manifest; returns undefined when missing or unparseable. */
export async function readSchemaManifest(dataDir: string): Promise<SchemaManifest | undefined> {
  const p = manifestPath(dataDir);
  if (!(await pathExists(p))) return undefined;
  try {
    const raw = await readJson<Partial<SchemaManifest>>(p);
    if (raw && typeof raw === 'object' && typeof raw.schema === 'number' && Number.isInteger(raw.schema)) {
      return {
        schema: raw.schema,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
        updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : '',
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Atomically write the manifest (tmp+rename via writeJson). */
export async function writeSchemaManifest(
  dataDir: string,
  schema: number,
  updatedBy: string,
): Promise<SchemaManifest> {
  const manifest: SchemaManifest = {
    schema,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await writeJson(manifestPath(dataDir), manifest);
  return manifest;
}

/** True when DATA_DIR has no user data yet (fresh install). */
async function isDataDirEmpty(dataDir: string): Promise<boolean> {
  if (!(await pathExists(dataDir))) return true;
  try {
    const entries = await fsp.readdir(dataDir);
    // Ignore the manifest itself and hidden dotfiles when judging emptiness.
    const meaningful = entries.filter((e) => e !== SCHEMA_MANIFEST_FILE && !e.startsWith('.'));
    return meaningful.length === 0;
  } catch {
    return true;
  }
}

export interface SchemaCheckResult {
  /** Schema version found on disk before the check (0 = legacy/no manifest). */
  found: number;
  /** Schema version after the check (== CURRENT_SCHEMA on success). */
  current: number;
  /** Migrations applied during this check, in order. */
  applied: Array<{ from: number; to: number; description: string }>;
  /** True when the manifest was (re)written during this check. */
  manifestWritten: boolean;
}

/**
 * Verify DATA_DIR schema compatibility and migrate if needed.
 *
 * @param paths      resolved dirs (dataDir/tasksDir/knowledgeDir)
 * @param updatedBy  package version stamped into the manifest (default: auto-detect)
 * @throws SchemaVersionError when on-disk schema is NEWER than CURRENT_SCHEMA
 */
export async function checkSchemaVersion(
  paths: SchemaMigrationPaths,
  updatedBy?: string,
): Promise<SchemaCheckResult> {
  const stampedBy = updatedBy ?? (await getPackageVersion());
  const manifest = await readSchemaManifest(paths.dataDir);

  // No manifest: distinguish fresh install from legacy data.
  let found: number;
  if (manifest === undefined) {
    found = (await isDataDirEmpty(paths.dataDir)) ? CURRENT_SCHEMA : 0;
  } else {
    found = manifest.schema;
  }

  if (found > CURRENT_SCHEMA) {
    throw new SchemaVersionError(
      `DATA_DIR was created by a newer schema version (${found}); ` +
        `this build supports up to ${CURRENT_SCHEMA}. ` +
        `Upgrade the package or restore a compatible DATA_DIR.`,
      found,
      CURRENT_SCHEMA,
    );
  }

  const applied: SchemaCheckResult['applied'] = [];
  let manifestWritten = false;

  if (found < CURRENT_SCHEMA) {
    for (const m of SCHEMA_MIGRATIONS.filter((m) => m.from >= found && m.to <= CURRENT_SCHEMA).sort(
      (a, b) => a.from - b.from,
    )) {
      log.info({ from: m.from, to: m.to, description: m.description }, 'applying schema migration');
      await m.migrate(paths);
      applied.push({ from: m.from, to: m.to, description: m.description });
    }
    await writeSchemaManifest(paths.dataDir, CURRENT_SCHEMA, stampedBy);
    manifestWritten = true;
  } else if (manifest === undefined) {
    // Fresh install — stamp the manifest so future upgrades have a baseline.
    await writeSchemaManifest(paths.dataDir, CURRENT_SCHEMA, stampedBy);
    manifestWritten = true;
  }

  return { found, current: CURRENT_SCHEMA, applied, manifestWritten };
}
