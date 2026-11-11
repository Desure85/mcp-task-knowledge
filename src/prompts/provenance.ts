/**
 * Z-06 — provenance, snapshots and diff-based updates for imported prompt/skill
 * packages.
 *
 * A package is a directory of files (relative paths) plus a manifest that
 * records where it came from (source, URL, version/commit, license, date),
 * the content hash at import time, and snapshots for rollback. Local edits are
 * detected by hashing the current files; an edited package is never overwritten
 * by `update()` without an explicit `force`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface PackageFile {
  path: string;
  content: string;
}

export interface PackageSource {
  kind: 'marketplace' | 'github' | 'local';
  id: string;
  url?: string;
  version?: string;
  commit?: string;
  license?: string;
  retrievedAt?: string;
}

export interface PackageSnapshotRef {
  snapshotId: string;
  version?: string;
  contentHash: string;
  importedAt: string;
}

export interface PackageManifest {
  id: string;
  source: PackageSource;
  importedAt: string;
  contentHash: string;
  snapshotId: string;
  history: PackageSnapshotRef[];
}

export type DiffStatus = 'added' | 'changed' | 'removed';

export interface PackageDiffEntry {
  path: string;
  status: DiffStatus;
}

export interface PackageStatus {
  id: string;
  modified: boolean;
  contentHash: string;
  importedHash: string;
  source: PackageSource;
  importedAt: string;
}

export interface PackageUpdateResult {
  updated: boolean;
  diff: PackageDiffEntry[];
  manifest: PackageManifest;
}

export type ProvenanceErrorCode = 'NOT_FOUND' | 'INVALID_PATH' | 'INVALID_ID' | 'MODIFIED' | 'EXISTS';

export class ProvenanceError extends Error {
  readonly code: ProvenanceErrorCode;
  constructor(code: ProvenanceErrorCode, message: string) {
    super(message);
    this.name = 'ProvenanceError';
    this.code = code;
  }
}

function safeId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id === '.' || id === '..') {
    throw new ProvenanceError('INVALID_ID', `invalid package id: ${id}`);
  }
  return id;
}

function safeRel(rel: string): string {
  const normal = rel.replace(/\\/g, '/');
  if (!normal || normal.includes('\0') || normal.startsWith('/') || /^[a-zA-Z]:/.test(normal)) {
    throw new ProvenanceError('INVALID_PATH', `invalid package path: ${rel}`);
  }
  const parts = normal.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new ProvenanceError('INVALID_PATH', `invalid package path: ${rel}`);
  }
  return parts.join('/');
}

function assertFiles(files: PackageFile[]): PackageFile[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const rel = safeRel(file.path);
    if (seen.has(rel)) throw new ProvenanceError('INVALID_PATH', `duplicate package path: ${rel}`);
    seen.add(rel);
    return { path: rel, content: file.content };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

/** Stable hash over sorted path + content (path-boundary safe). */
export function hashPackageFiles(files: PackageFile[]): string {
  const hash = createHash('sha256');
  for (const file of assertFiles(files)) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(Buffer.byteLength(file.content, 'utf8')));
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function diffPackageFiles(current: PackageFile[], next: PackageFile[]): PackageDiffEntry[] {
  const before = new Map(current.map((file) => [safeRel(file.path), file.content]));
  const after = new Map(next.map((file) => [safeRel(file.path), file.content]));
  const paths = new Set([...before.keys(), ...after.keys()]);
  const diff: PackageDiffEntry[] = [];
  for (const rel of [...paths].sort()) {
    const a = before.get(rel);
    const b = after.get(rel);
    if (a === undefined) diff.push({ path: rel, status: 'added' });
    else if (b === undefined) diff.push({ path: rel, status: 'removed' });
    else if (a !== b) diff.push({ path: rel, status: 'changed' });
  }
  return diff;
}

async function listFiles(dir: string, prefix = ''): Promise<PackageFile[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PackageFile[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({ path: rel, content: await fs.readFile(full, 'utf8') });
    } else {
      throw new ProvenanceError('INVALID_PATH', `symlink or special file is not allowed: ${rel}`);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function writeFiles(root: string, files: PackageFile[]): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  for (const file of assertFiles(files)) {
    const full = path.join(root, file.path);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ProvenanceError('INVALID_PATH', `path escapes package: ${file.path}`);
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, file.content, 'utf8');
  }
}

async function copyFiles(from: string, to: string): Promise<void> {
  const files = await listFiles(from);
  await writeFiles(to, files);
}

export class PromptProvenanceStore {
  constructor(private readonly root: string) {}

  private packageDir(id: string): string {
    return path.join(path.resolve(this.root), safeId(id));
  }

  private currentDir(id: string): string {
    return path.join(this.packageDir(id), 'files');
  }

  private snapshotsDir(id: string): string {
    return path.join(this.packageDir(id), 'snapshots');
  }

  private manifestPath(id: string): string {
    return path.join(this.packageDir(id), 'manifest.json');
  }

  async readManifest(id: string): Promise<PackageManifest> {
    try {
      return JSON.parse(await fs.readFile(this.manifestPath(id), 'utf8')) as PackageManifest;
    } catch {
      throw new ProvenanceError('NOT_FOUND', `package not found: ${id}`);
    }
  }

  async currentFiles(id: string): Promise<PackageFile[]> {
    await this.readManifest(id);
    return listFiles(this.currentDir(id));
  }

  async status(id: string): Promise<PackageStatus> {
    const manifest = await this.readManifest(id);
    const contentHash = hashPackageFiles(await listFiles(this.currentDir(id)));
    return {
      id,
      modified: contentHash !== manifest.contentHash,
      contentHash,
      importedHash: manifest.contentHash,
      source: manifest.source,
      importedAt: manifest.importedAt,
    };
  }

  /**
   * Install a package. Existing packages are refused unless `overwrite` is
   * explicit; overwrite archives the old state as a snapshot.
   */
  async import(
    id: string,
    files: PackageFile[],
    source: PackageSource,
    options: { overwrite?: boolean } = {},
  ): Promise<PackageManifest> {
    const dir = this.packageDir(id);
    const exists = await fs.stat(dir).then(() => true).catch(() => false);
    if (exists && !options.overwrite) throw new ProvenanceError('EXISTS', `package already exists: ${id}`);
    let history: PackageSnapshotRef[] = [];
    if (exists) {
      const previous = await this.readManifest(id);
      history = [...previous.history];
      const archiveId = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}`;
      await copyFiles(this.currentDir(id), path.join(this.snapshotsDir(id), archiveId, 'files'));
      await fs.rm(this.currentDir(id), { recursive: true, force: true });
      history.push({
        snapshotId: archiveId,
        version: previous.source.version,
        contentHash: previous.contentHash,
        importedAt: previous.importedAt,
      });
      await fs.mkdir(this.packageDir(id), { recursive: true });
    }

    const safeFiles = assertFiles(files);
    const importedAt = source.retrievedAt ?? new Date().toISOString();
    const snapshotId = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await writeFiles(this.currentDir(id), safeFiles);
    await writeFiles(path.join(this.snapshotsDir(id), snapshotId, 'files'), safeFiles);
    const manifest: PackageManifest = {
      id,
      source,
      importedAt,
      contentHash: hashPackageFiles(safeFiles),
      snapshotId,
      history,
    };
    await fs.writeFile(this.manifestPath(id), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  /** Compute what an update would change, without writing. */
  async diff(id: string, nextFiles: PackageFile[]): Promise<PackageDiffEntry[]> {
    return diffPackageFiles(await this.currentFiles(id), nextFiles);
  }

  /**
   * Update a package to new source files. An edited package is rejected with
   * `MODIFIED` unless `force` is set. The pre-update state is snapshotted.
   */
  async update(
    id: string,
    nextFiles: PackageFile[],
    source: PackageSource,
    options: { force?: boolean } = {},
  ): Promise<PackageUpdateResult> {
    const manifest = await this.readManifest(id);
    const current = await listFiles(this.currentDir(id));
    const currentHash = hashPackageFiles(current);
    if (currentHash !== manifest.contentHash && !options.force) {
      throw new ProvenanceError('MODIFIED', `package was modified locally: ${id}`);
    }
    const diff = diffPackageFiles(current, nextFiles);
    if (diff.length === 0) return { updated: false, diff, manifest };

    const previousSnapshot = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await writeFiles(path.join(this.snapshotsDir(id), previousSnapshot, 'files'), current);
    const nextSnapshot = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const safeFiles = assertFiles(nextFiles);
    await fs.rm(this.currentDir(id), { recursive: true, force: true });
    await writeFiles(this.currentDir(id), safeFiles);
    await writeFiles(path.join(this.snapshotsDir(id), nextSnapshot, 'files'), safeFiles);

    const updated: PackageManifest = {
      ...manifest,
      source,
      importedAt: source.retrievedAt ?? new Date().toISOString(),
      contentHash: hashPackageFiles(safeFiles),
      snapshotId: nextSnapshot,
      history: [
        ...manifest.history,
        {
          snapshotId: previousSnapshot,
          version: manifest.source.version,
          contentHash: manifest.contentHash,
          importedAt: manifest.importedAt,
        },
      ],
    };
    await fs.writeFile(this.manifestPath(id), JSON.stringify(updated, null, 2), 'utf8');
    return { updated: true, diff, manifest: updated };
  }

  /** Restore files from a snapshot and record the prior state in history. */
  async rollback(id: string, snapshotId: string): Promise<PackageManifest> {
    const manifest = await this.readManifest(id);
    const safeSnapshot = safeRel(snapshotId);
    const snapshotRoot = path.join(this.snapshotsDir(id), safeSnapshot, 'files');
    const snapshotFiles = await listFiles(snapshotRoot);
    if (snapshotFiles.length === 0) throw new ProvenanceError('NOT_FOUND', `snapshot not found: ${snapshotId}`);
    const current = await listFiles(this.currentDir(id));
    const previousSnapshot = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await writeFiles(path.join(this.snapshotsDir(id), previousSnapshot, 'files'), current);
    await fs.rm(this.currentDir(id), { recursive: true, force: true });
    await writeFiles(this.currentDir(id), snapshotFiles);
    const restored: PackageManifest = {
      ...manifest,
      contentHash: hashPackageFiles(snapshotFiles),
      snapshotId: safeSnapshot,
      history: [
        ...manifest.history,
        {
          snapshotId: previousSnapshot,
          version: manifest.source.version,
          contentHash: hashPackageFiles(current),
          importedAt: manifest.importedAt,
        },
      ],
    };
    await fs.writeFile(this.manifestPath(id), JSON.stringify(restored, null, 2), 'utf8');
    return restored;
  }
}
