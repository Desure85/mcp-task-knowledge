/**
 * SC-06 — optional sharded layout for file-profile project data.
 *
 * Legacy layout:  <root>/<id>.json|md
 * Sharded layout: <root>/<first-two-id-chars>/<id>.json|md
 *
 * Both layouts are readable; writes move to shards once a project crosses the
 * threshold (or after an explicit migration writes the `.sharded` marker).
 * `listDataFiles` deduplicates by id and prefers the legacy root copy, so a
 * half-finished migration cannot produce duplicate records.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_SHARD_THRESHOLD = 50_000;
export const SHARD_MARKER = '.sharded';

const rootCountCache = new Map<string, number>();
const shardedCache = new Map<string, boolean>();

export function shardOfId(id: string): string {
  const m = String(id).toLowerCase().match(/^[a-z0-9]{2}/);
  return m ? m[0] : 'zz';
}

export function isShardDir(name: string): boolean {
  return /^[a-z0-9]{2}$/.test(name);
}

export interface DataFileEntry {
  id: string;
  file: string;
}

async function markerExists(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, SHARD_MARKER));
    return true;
  } catch {
    return false;
  }
}

/**
 * List root-level files plus files in two-character shard directories.
 * `legacyFlat` must be true when `root` is the flat TASKS_DIR/KNOWLEDGE_DIR:
 * its child directories are projects, not shards.
 */
export async function listDataFiles(
  root: string,
  ext: string,
  opts: { legacyFlat?: boolean } = {},
): Promise<DataFileEntry[]> {
  const byId = new Map<string, string>();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(ext)) {
      byId.set(e.name.slice(0, -ext.length), path.join(root, e.name));
    }
  }
  if (!opts.legacyFlat) {
    for (const e of entries) {
      if (!e.isDirectory() || !isShardDir(e.name)) continue;
      const shardDir = path.join(root, e.name);
      let shardEntries;
      try {
        shardEntries = await fs.readdir(shardDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of shardEntries) {
        if (!f.isFile() || !f.name.endsWith(ext)) continue;
        const id = f.name.slice(0, -ext.length);
        if (!byId.has(id)) byId.set(id, path.join(shardDir, f.name));
      }
    }
  }
  return [...byId].map(([id, file]) => ({ id, file }));
}

export async function resolveDataFile(root: string, id: string, ext: string): Promise<string | null> {
  const rootFile = path.join(root, `${id}${ext}`);
  try {
    await fs.access(rootFile);
    return rootFile;
  } catch {
    // fall through to shard
  }
  const shardFile = path.join(root, shardOfId(id), `${id}${ext}`);
  try {
    await fs.access(shardFile);
    return shardFile;
  } catch {
    return null;
  }
}

/** Move every root-level data file into its shard; idempotent, no overwrite. */
export async function migrateToShards(
  root: string,
  ext: string,
  opts: { threshold?: number; force?: boolean } = {},
): Promise<{ moved: number; skipped: number; sharded: boolean }> {
  const files = await listDataFiles(root, ext, { legacyFlat: true });
  if (!opts.force && opts.threshold !== undefined && files.length < opts.threshold) {
    return { moved: 0, skipped: 0, sharded: await markerExists(root) };
  }
  let moved = 0;
  let skipped = 0;
  for (const { id, file } of files) {
    const dir = path.join(root, shardOfId(id));
    const dest = path.join(dir, `${id}${ext}`);
    try {
      await fs.access(dest);
      skipped++;
      continue;
    } catch {
      // destination does not exist: safe to move
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(file, dest);
    moved++;
  }
  await fs.writeFile(path.join(root, SHARD_MARKER), '1\n', 'utf8');
  shardedCache.set(root, true);
  rootCountCache.set(root, 0);
  return { moved, skipped, sharded: true };
}

/** Collapse shards back into root when the project is small again. */
export async function compactShards(
  root: string,
  ext: string,
  opts: { force?: boolean; threshold?: number } = {},
): Promise<{ moved: number; sharded: boolean }> {
  const files = await listDataFiles(root, ext);
  const rootFiles = files.filter((f) => path.dirname(f.file) === root);
  if (!opts.force && opts.threshold !== undefined && files.length >= opts.threshold) {
    return { moved: 0, sharded: true };
  }
  let moved = 0;
  for (const { id, file } of files) {
    if (path.dirname(file) === root) continue;
    const dest = path.join(root, `${id}${ext}`);
    try {
      await fs.access(dest);
      continue;
    } catch {
      // safe to move
    }
    await fs.rename(file, dest);
    moved++;
  }
  // Remove empty two-character shard dirs and the marker.
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && isShardDir(e.name)) {
      const left = await fs.readdir(path.join(root, e.name)).catch(() => []);
      if (left.length === 0) await fs.rmdir(path.join(root, e.name)).catch(() => {});
    }
  }
  await fs.rm(path.join(root, SHARD_MARKER), { force: true });
  shardedCache.set(root, false);
  rootCountCache.set(root, rootFiles.length + moved);
  return { moved, sharded: false };
}

/** Whether writes for this root should go to shards (marker or threshold). */
export async function ensureSharded(
  root: string,
  ext: string,
  threshold = DEFAULT_SHARD_THRESHOLD,
): Promise<boolean> {
  if (shardedCache.get(root)) return true;
  if (await markerExists(root)) {
    shardedCache.set(root, true);
    return true;
  }
  let count = rootCountCache.get(root);
  if (count === undefined) {
    count = (await listDataFiles(root, ext, { legacyFlat: true })).length;
    rootCountCache.set(root, count);
  }
  if (count < threshold) return false;
  await migrateToShards(root, ext, { force: true });
  return true;
}

/** Resolve a write path, migrating the project once the threshold is crossed. */
export async function writeDataPath(
  root: string,
  id: string,
  ext: string,
  threshold = DEFAULT_SHARD_THRESHOLD,
): Promise<string> {
  const existing = await resolveDataFile(root, id, ext);
  if (existing) return existing;
  if (await ensureSharded(root, ext, threshold)) {
    return path.join(root, shardOfId(id), `${id}${ext}`);
  }
  const count = rootCountCache.get(root);
  rootCountCache.set(root, (count ?? 0) + 1);
  return path.join(root, `${id}${ext}`);
}
