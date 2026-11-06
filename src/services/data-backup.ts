/**
 * data-backup.ts — pre-destructive-operation snapshots of DATA_DIR (DX-19).
 *
 * Problem: `project_purge`, `*_bulk_delete_permanent` and GC event-log
 * permanently delete user data. A wrong filter or a misclick is
 * unrecoverable. Copying files is cheap; "oops" should become a restore,
 * not data loss.
 *
 * Design:
 *   - Every backup is `DATA_DIR/.backups/<timestamp>-<label>/` containing
 *     the affected scope plus a `manifest.json` describing what was copied.
 *   - `.backups/` lives at DATA_DIR root and is NEVER scanned by doctor,
 *     storage iteration, or prompts tooling (all of those walk only the
 *     tasks/knowledge/projects subtrees).
 *   - Backups are plain file copies — no compression, no incremental
 *     snapshots, no remote upload. Restore = copy back per manifest.
 *
 * Failure policy (deliberate decision):
 *   - Callers wrap createDataBackup in try/catch and proceed on failure —
 *     deleting user data WITHOUT a backup is worse than a failed backup
 *     attempt. BACKUP_REQUIRED=1 flips this to fail-closed for operators
 *     who prefer the op to abort rather than run unprotected.
 *   - Oversized scopes (> BACKUP_MAX_MB) still proceed — a large backup
 *     beats no backup — but the manifest records `oversized: true` and a
 *     warning is logged.
 */

import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import {
  ensureDir,
  pathExists,
  writeJson,
  readJson,
  withFileLock,
  resolveUnderPath,
  PathValidationError,
} from '../fs.js';
import { childLogger } from '../core/logger.js';
import { readBackupArchive } from './backup-archive.js';

const log = childLogger('data-backup');

/** Directory inside DATA_DIR where snapshots are stored. */
export const BACKUPS_DIR_NAME = '.backups';

/** Manifest filename inside each backup dir. */
export const BACKUP_MANIFEST_FILE = 'manifest.json';

/** Runtime lock written by the server (MU-01). Never archived, never restored. */
export const SERVER_LOCK_NAME = '.server.lock';

/** Inter-process restore lock (ADR-008 §8). Never archived, never restored. */
export const RESTORE_LOCK_NAME = '.restore.lock';

/** Scratch directory used while applying an archive restore. */
export const RESTORE_TMP_DIR_NAME = '.restore-tmp';

/** Files excluded from exports/restores unless the caller opts in. */
export const SECRET_FILE_NAMES = ['.jwt-revoked.json', 'auth.db'] as const;

/** Top-level names that never take part in a backup or a restore. */
const RUNTIME_SKIP_NAMES = [
  BACKUPS_DIR_NAME,
  '.embeddings',
  '.emb_cache',
  RESTORE_TMP_DIR_NAME,
  SERVER_LOCK_NAME,
  RESTORE_LOCK_NAME,
] as const;

export type BackupScope = 'project' | 'full' | 'tasks' | 'knowledge';

export interface BackupPaths {
  dataDir: string;
  tasksDir: string;
  knowledgeDir: string;
}

export interface CreateBackupOptions extends BackupPaths {
  /** Short slug for the backup dir name, e.g. 'pre-purge', 'pre-bulk-delete'. */
  label: string;
  /** What to snapshot. Default: 'full'. */
  scope?: BackupScope;
  /** Project id — required for scope='project', optional filter for tasks/knowledge. */
  project?: string;
  /** Tool name recorded in the manifest (e.g. 'project_purge'). */
  tool?: string;
  /** Max bytes to copy before flagging oversized (env BACKUP_MAX_MB, default 512). */
  maxBytes?: number;
  /** How many backups to keep (env BACKUP_KEEP, default 20). */
  keep?: number;
  /**
   * Copy `.jwt-revoked.json` and `auth.db` too. Off by default: a restore that
   * brings back an old revocation list resurrects revoked tokens (ADR-008 §3).
   * The pre-restore snapshot sets it deliberately — that snapshot never leaves
   * the machine (ADR-008 §11).
   */
  includeSecrets?: boolean;
}

export interface BackupManifest {
  createdAt: string;
  label: string;
  scope: BackupScope;
  project?: string;
  /** Absolute source paths that were copied, relative backup targets. */
  paths: Array<{ from: string; to: string }>;
  filesCount: number;
  bytes: number;
  tool?: string;
  /** True when the copied payload exceeded the configured size bound. */
  oversized?: boolean;
  /** Top-level names deliberately left out of the snapshot. */
  excluded?: string[];
}

export interface BackupResult {
  backupDir: string;
  manifest: BackupManifest;
}

export interface BackupInfo {
  backupDir: string;
  name: string;
  manifest?: BackupManifest;
}

export type RestoreAction = 'create' | 'overwrite' | 'delete';

export interface RestorePlanItem {
  /** Path relative to DATA_DIR, '/'-separated. */
  path: string;
  type: 'file' | 'dir';
  action: RestoreAction;
}

export interface RestoreOptions {
  dryRun?: boolean;
  /** Target DATA_DIR; inferred from `<DATA_DIR>/.backups/<name>` when omitted. */
  dataDir?: string;
  /** Restore `.jwt-revoked.json` / `auth.db` from the snapshot. Off by default. */
  includeSecrets?: boolean;
  /** Delete files under the restored roots that are absent from the snapshot. Default true. */
  prune?: boolean;
}

export interface RestoreResult {
  restored: Array<{ from: string; to: string }>;
  filesCount: number;
  dryRun: boolean;
  dataDir: string;
  creates: RestorePlanItem[];
  overwrites: RestorePlanItem[];
  deletes: RestorePlanItem[];
  warnings: string[];
}

export type RestoreErrorCode =
  | 'RESTORE_CONFIRM_REQUIRED'
  | 'RESTORE_TARGET_BUSY'
  | 'RESTORE_SNAPSHOT_FAILED';

/** Stable, machine-readable restore error (ADR-008 §4 error table). */
export class RestoreError extends Error {
  constructor(
    readonly code: RestoreErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'RestoreError';
  }
}

// ── env helpers ─────────────────────────────────────────────────────

function envNum(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function maxBytesDefault(): number {
  return envNum('BACKUP_MAX_MB', 512) * 1024 * 1024;
}

function keepDefault(): number {
  return envNum('BACKUP_KEEP', 20);
}

/** Whether backup failure must abort the destructive op (opt-in strict mode). */
export function isBackupRequired(): boolean {
  const v = (process.env.BACKUP_REQUIRED ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// ── internals ───────────────────────────────────────────────────────

function backupsRoot(dataDir: string): string {
  return path.join(dataDir, BACKUPS_DIR_NAME);
}

/** Filesystem-safe label: keep alnum/dash/underscore/dot, collapse the rest. */
function sanitizeLabel(label: string): string {
  const s = String(label ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s.length > 0 ? s : 'backup';
}

/** Timestamp that sorts lexicographically: 2026-09-12T13-45-30-123Z. */
function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

async function dirSizeAndCount(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        files++;
        try {
          bytes += (await fsp.stat(p)).size;
        } catch {
          /* file vanished mid-scan — ignore */
        }
      }
    }
  }
  return { bytes, files };
}

async function copyDir(src: string, dst: string): Promise<void> {
  await ensureDir(dst);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fsp.copyFile(s, d);
    } else if (e.isSymbolicLink()) {
      const target = await fsp.readlink(s);
      await fsp.symlink(target, d).catch(() => {});
    }
  }
}

/**
 * Resolve which source dirs/files a scope covers.
 * Returns absolute source paths paired with their relative location inside
 * the backup dir (so restore can map them back).
 */
async function resolveScopePaths(
  opts: CreateBackupOptions,
): Promise<Array<{ from: string; to: string }>> {
  const scope: BackupScope = opts.scope ?? 'full';
  const pairs: Array<{ from: string; to: string }> = [];

  const pushIfExists = async (from: string, to: string) => {
    if (await pathExists(from)) pairs.push({ from, to });
  };

  if (scope === 'full') {
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(opts.dataDir);
    } catch {
      return [];
    }
    const skip = new Set<string>(RUNTIME_SKIP_NAMES);
    if (!opts.includeSecrets) for (const name of SECRET_FILE_NAMES) skip.add(name);
    for (const name of entries) {
      if (skip.has(name)) continue;
      await pushIfExists(path.join(opts.dataDir, name), name);
    }
    return pairs;
  }

  if (scope === 'project') {
    const project = opts.project;
    if (!project) throw new Error("scope 'project' requires opts.project");
    await pushIfExists(path.join(opts.tasksDir, project), path.join('tasks', project));
    await pushIfExists(path.join(opts.knowledgeDir, project), path.join('knowledge', project));
    await pushIfExists(
      path.join(opts.dataDir, 'projects', `${project}.json`),
      path.join('projects', `${project}.json`),
    );
    return pairs;
  }

  if (scope === 'tasks' || scope === 'knowledge') {
    const base = scope === 'tasks' ? opts.tasksDir : opts.knowledgeDir;
    if (opts.project) {
      await pushIfExists(path.join(base, opts.project), path.join(scope, opts.project));
    } else {
      await pushIfExists(base, scope);
    }
    return pairs;
  }

  return pairs;
}

async function rotateBackups(dataDir: string, keep: number): Promise<void> {
  if (keep <= 0) return;
  const root = backupsRoot(dataDir);
  let names: string[] = [];
  try {
    names = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return;
  }
  // Timestamped names sort chronologically.
  names.sort();
  const excess = names.length - keep;
  for (let i = 0; i < excess; i++) {
    const victim = path.join(root, names[i]);
    await fsp.rm(victim, { recursive: true, force: true }).catch((e) => {
      log.warn({ err: e, victim }, 'backup rotation: failed to remove old backup');
    });
  }
}

// ── public API ──────────────────────────────────────────────────────

/**
 * Snapshot the affected scope into `DATA_DIR/.backups/<ts>-<label>/`.
 * Returns undefined when the scope resolves to nothing (empty scope →
 * no empty backup dirs). Rotates old backups past `keep`.
 */
export async function createDataBackup(opts: CreateBackupOptions): Promise<BackupResult | undefined> {
  const pairs = await resolveScopePaths(opts);
  if (pairs.length === 0) {
    log.info({ scope: opts.scope ?? 'full', project: opts.project }, 'backup skipped: scope is empty');
    return undefined;
  }

  const maxBytes = opts.maxBytes ?? maxBytesDefault();
  const keep = opts.keep ?? keepDefault();

  const backupDir = path.join(backupsRoot(opts.dataDir), `${stamp()}-${sanitizeLabel(opts.label)}`);
  await ensureDir(backupDir);

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    label: opts.label,
    scope: opts.scope ?? 'full',
    project: opts.project,
    paths: [],
    filesCount: 0,
    bytes: 0,
    tool: opts.tool,
    excluded: [...RUNTIME_SKIP_NAMES, ...(opts.includeSecrets ? [] : SECRET_FILE_NAMES)],
  };

  for (const { from, to } of pairs) {
    const target = path.join(backupDir, to);
    const stat = await fsp.stat(from);
    if (stat.isDirectory()) {
      await copyDir(from, target);
      const { bytes, files } = await dirSizeAndCount(target);
      manifest.bytes += bytes;
      manifest.filesCount += files;
    } else {
      await ensureDir(path.dirname(target));
      await fsp.copyFile(from, target);
      manifest.bytes += stat.size;
      manifest.filesCount += 1;
    }
    manifest.paths.push({ from, to });
  }

  if (manifest.bytes > maxBytes) {
    manifest.oversized = true;
    log.warn(
      { bytes: manifest.bytes, maxBytes, backupDir },
      'backup exceeds BACKUP_MAX_MB — proceeding anyway (a large backup beats no backup)',
    );
  }

  await writeJson(path.join(backupDir, BACKUP_MANIFEST_FILE), manifest);
  log.info(
    { backupDir, files: manifest.filesCount, bytes: manifest.bytes, scope: manifest.scope },
    'data backup created',
  );

  await rotateBackups(opts.dataDir, keep);
  return { backupDir, manifest };
}

/** List backups under DATA_DIR/.backups, newest first. */
export async function listBackups(dataDir: string): Promise<BackupInfo[]> {
  const root = backupsRoot(dataDir);
  let names: string[] = [];
  try {
    names = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  names.sort().reverse();
  const out: BackupInfo[] = [];
  for (const name of names) {
    const backupDir = path.join(root, name);
    let manifest: BackupManifest | undefined;
    try {
      manifest = await readJson<BackupManifest>(path.join(backupDir, BACKUP_MANIFEST_FILE));
    } catch {
      /* missing/corrupt manifest — still list the dir */
    }
    out.push({ backupDir, name, manifest });
  }
  return out;
}

// ── restore engine (DX-16b) ─────────────────────────────────────────

interface DiskEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
}

interface RestorePlan {
  dataDir: string;
  entries: RestorePlanItem[];
  creates: RestorePlanItem[];
  overwrites: RestorePlanItem[];
  deletes: RestorePlanItem[];
  warnings: string[];
  digest: string;
}

function isRestoreSkipped(relPath: string, includeSecrets: boolean): string | null {
  const top = relPath.split('/')[0];
  if ((RUNTIME_SKIP_NAMES as readonly string[]).includes(top)) {
    return `protected path skipped: ${top}`;
  }
  if (!includeSecrets && (SECRET_FILE_NAMES as readonly string[]).includes(top)) {
    return `secret skipped without include-secrets: ${top}`;
  }
  return null;
}

function inferDataDir(backupDir: string): string {
  const parent = path.dirname(path.resolve(backupDir));
  if (path.basename(parent) !== BACKUPS_DIR_NAME) {
    throw new PathValidationError(`cannot infer DATA_DIR from ${backupDir}; pass opts.dataDir`);
  }
  return path.dirname(parent);
}

async function walkDiskTree(dir: string, relDir: string): Promise<DiskEntry[]> {
  const out: DiskEntry[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: dir, rel: relDir }];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(cur.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur.abs, e.name);
      const rel = `${cur.rel}/${e.name}`;
      const st = await fsp.lstat(abs).catch(() => null);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        out.push({ path: rel, type: 'symlink' });
      } else if (st.isDirectory()) {
        out.push({ path: rel, type: 'dir' });
        stack.push({ abs, rel });
      } else if (st.isFile()) {
        out.push({ path: rel, type: 'file' });
      }
    }
  }
  return out;
}

async function walkBackupTree(root: string, relDir: string, warnings: string[]): Promise<DiskEntry[]> {
  const out: DiskEntry[] = [];
  for (const entry of await walkDiskTree(root, relDir)) {
    if (entry.type === 'symlink') {
      warnings.push(`symlink skipped: ${entry.path}`);
      continue;
    }
    out.push(entry);
  }
  return out;
}

function planDigest(dataDir: string, items: RestorePlanItem[]): string {
  const norm = items
    .map((i) => `${i.action}:${i.type}:${i.path}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('\n');
  return createHash('sha256').update(`${path.resolve(dataDir)}\n${norm}`).digest('hex');
}

async function buildRestorePlan(opts: {
  dataDir: string;
  entries: Array<{ path: string; type: 'file' | 'dir' }>;
  prune: boolean;
  includeSecrets: boolean;
}): Promise<RestorePlan> {
  const dataDir = path.resolve(opts.dataDir);
  const warnings: string[] = [];
  const wanted = new Map<string, 'file' | 'dir'>();
  for (const entry of opts.entries) {
    const skip = isRestoreSkipped(entry.path, opts.includeSecrets);
    if (skip) {
      warnings.push(skip);
      continue;
    }
    resolveUnderPath(dataDir, entry.path);
    if (!wanted.has(entry.path)) wanted.set(entry.path, entry.type);
  }

  const items: RestorePlanItem[] = [];
  for (const [rel, type] of [...wanted.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const target = resolveUnderPath(dataDir, rel);
    const st = await fsp.lstat(target).catch(() => null);
    if (!st) {
      items.push({ path: rel, type, action: 'create' });
      continue;
    }
    const matches = type === 'dir' ? st.isDirectory() : st.isFile();
    if (!matches || type === 'file') items.push({ path: rel, type, action: 'overwrite' });
  }

  const deletes: RestorePlanItem[] = [];
  if (opts.prune) {
    const roots = new Set<string>();
    for (const rel of wanted.keys()) roots.add(rel.split('/')[0]);
    for (const root of [...roots].sort()) {
      const st = await fsp.lstat(resolveUnderPath(dataDir, root)).catch(() => null);
      if (!st || !st.isDirectory()) continue;
      for (const disk of await walkDiskTree(resolveUnderPath(dataDir, root), root)) {
        if (isRestoreSkipped(disk.path, opts.includeSecrets)) continue;
        if (wanted.has(disk.path)) continue;
        deletes.push({
          path: disk.path,
          type: disk.type === 'dir' ? 'dir' : 'file',
          action: 'delete',
        });
      }
    }
    deletes.sort((a, b) => b.path.length - a.path.length);
  }

  const creates = items.filter((i) => i.action === 'create');
  const overwrites = items.filter((i) => i.action === 'overwrite');
  return {
    dataDir,
    entries: items,
    creates,
    overwrites,
    deletes,
    warnings,
    digest: planDigest(dataDir, [...items, ...deletes]),
  };
}

async function assertRealAncestors(dataDir: string, target: string): Promise<void> {
  const parts = path.relative(dataDir, target).split(path.sep).filter(Boolean);
  let cur = dataDir;
  for (const part of parts.slice(0, -1)) {
    cur = path.join(cur, part);
    const st = await fsp.lstat(cur).catch(() => null);
    if (!st) return;
    if (st.isSymbolicLink()) {
      throw new PathValidationError(`refusing to write through a symlink: ${cur}`);
    }
    if (!st.isDirectory()) {
      throw new PathValidationError(`path component is not a directory: ${cur}`);
    }
  }
}

async function removeTarget(target: string): Promise<void> {
  const st = await fsp.lstat(target).catch(() => null);
  if (!st) return;
  if (st.isDirectory()) await fsp.rm(target, { recursive: true, force: true });
  else await fsp.unlink(target);
}

async function ensureRealDirChain(dataDir: string, dir: string): Promise<void> {
  const parts = path.relative(dataDir, dir).split(path.sep).filter(Boolean);
  let cur = dataDir;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = await fsp.lstat(cur).catch(() => null);
    if (st?.isSymbolicLink()) {
      throw new PathValidationError(`refusing to write through a symlink: ${cur}`);
    }
    if (st && !st.isDirectory()) await removeTarget(cur);
    await ensureDir(cur);
  }
}

async function applyRestorePlan(plan: RestorePlan, sourceRoot: string): Promise<{ filesCount: number }> {
  const dirs = plan.entries
    .filter((i) => i.type === 'dir')
    .sort((a, b) => a.path.length - b.path.length);
  for (const item of dirs) {
    const target = resolveUnderPath(plan.dataDir, item.path);
    await assertRealAncestors(plan.dataDir, target);
    const st = await fsp.lstat(target).catch(() => null);
    if (st && !st.isDirectory()) await removeTarget(target);
    await ensureDir(target);
  }

  let filesCount = 0;
  for (const item of plan.entries) {
    if (item.type !== 'file') continue;
    const target = resolveUnderPath(plan.dataDir, item.path);
    await ensureRealDirChain(plan.dataDir, path.dirname(target));
    await assertRealAncestors(plan.dataDir, target);
    const st = await fsp.lstat(target).catch(() => null);
    if (st && !st.isFile()) await removeTarget(target);
    await fsp.copyFile(resolveUnderPath(sourceRoot, item.path), target);
    filesCount++;
  }

  for (const item of plan.deletes) {
    const target = resolveUnderPath(plan.dataDir, item.path);
    const st = await fsp.lstat(target).catch(() => null);
    if (!st) continue;
    await assertRealAncestors(plan.dataDir, target);
    if (st.isDirectory()) {
      await fsp.rmdir(target).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOTEMPTY' && e.code !== 'ENOENT') throw e;
      });
    } else {
      await fsp.unlink(target);
    }
  }
  return { filesCount };
}

/**
 * Restore a directory snapshot: replace the snapshot's scope inside DATA_DIR.
 *
 * The destination is derived from the manifest's relative `to` path resolved
 * under DATA_DIR; the absolute `from` recorded at backup time is never used as
 * a write target (defect Д1). Symlinks inside the snapshot are skipped rather
 * than recreated (Д2). Secrets are left untouched unless `includeSecrets` is
 * set (Д3). With `prune` (default) files under the restored roots that are
 * absent from the snapshot are deleted, so the result is the snapshot and not
 * an overlay (Д4).
 */
export async function restoreBackup(
  backupDir: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const dryRun = opts.dryRun === true;
  const manifest = await readJson<BackupManifest>(path.join(backupDir, BACKUP_MANIFEST_FILE));
  if (!manifest || !Array.isArray(manifest.paths)) {
    throw new Error(`backup manifest missing or invalid in ${backupDir}`);
  }

  const dataDir = path.resolve(opts.dataDir ?? inferDataDir(backupDir));
  const includeSecrets = opts.includeSecrets === true;
  const warnings: string[] = [];

  const entries = new Map<string, 'file' | 'dir'>();
  for (const entry of manifest.paths) {
    if (!entry || typeof entry.to !== 'string') {
      warnings.push('manifest entry without `to` skipped');
      continue;
    }
    resolveUnderPath(dataDir, entry.to);
    const src = path.join(backupDir, entry.to);
    const st = await fsp.lstat(src).catch(() => null);
    if (!st) {
      warnings.push(`manifest path missing in backup: ${entry.to}`);
      continue;
    }
    if (st.isSymbolicLink()) {
      warnings.push(`symlink skipped: ${entry.to}`);
      continue;
    }
    if (st.isDirectory()) {
      entries.set(entry.to, 'dir');
      for (const disk of await walkBackupTree(src, entry.to, warnings)) {
        entries.set(disk.path, disk.type === 'dir' ? 'dir' : 'file');
      }
    } else if (st.isFile()) {
      entries.set(entry.to, 'file');
    }
  }

  const plan = await buildRestorePlan({
    dataDir,
    entries: [...entries].map(([p, type]) => ({ path: p, type })),
    prune: opts.prune !== false,
    includeSecrets,
  });
  const allWarnings = [...warnings, ...plan.warnings];
  const restored = plan.entries.map((item) => ({
    from: path.join(backupDir, item.path),
    to: resolveUnderPath(dataDir, item.path),
  }));

  if (dryRun) {
    return {
      restored,
      filesCount: plan.entries.filter((i) => i.type === 'file').length,
      dryRun: true,
      dataDir,
      creates: plan.creates,
      overwrites: plan.overwrites,
      deletes: plan.deletes,
      warnings: allWarnings,
    };
  }

  const { filesCount } = await applyRestorePlan(plan, backupDir);
  log.info({ backupDir, dataDir, filesCount, deletes: plan.deletes.length }, 'backup restored');
  return {
    restored,
    filesCount,
    dryRun: false,
    dataDir,
    creates: plan.creates,
    overwrites: plan.overwrites,
    deletes: plan.deletes,
    warnings: allWarnings,
  };
}

// ── inter-process restore lock (ADR-008 §8) ─────────────────────────

export interface RestoreLockHolder {
  pid: number;
  startedAt: number;
  host: string;
  token: string;
}

export interface RestoreLockHandle {
  holder: RestoreLockHolder;
  release(): Promise<void>;
}

export interface RestoreLockOptions {
  pid?: number;
  now?: number;
  staleMs?: number;
  graceMs?: number;
  host?: string;
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readRestoreLock(
  file: string,
): Promise<{ exists: boolean; holder: RestoreLockHolder | null; mtimeMs: number }> {
  try {
    const [raw, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    let holder: RestoreLockHolder | null = null;
    if (parsed !== null) {
      const { pid, startedAt, token } = parsed;
      if (Number.isInteger(pid) && Number.isFinite(startedAt) && typeof token === 'string') {
        holder = {
          pid: pid as number,
          startedAt: startedAt as number,
          host: typeof parsed.host === 'string' ? parsed.host : '',
          token,
        };
      }
    }
    return {
      exists: true,
      holder,
      mtimeMs: stat.mtimeMs,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, holder: null, mtimeMs: 0 };
    throw e;
  }
}

const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

/** `fs.link` publishes the payload in one step, so a contender never sees an empty lock file. */
async function createLockFile(file: string, payload: string): Promise<boolean> {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fsp.writeFile(tmp, payload, 'utf8');
    try {
      await fsp.link(tmp, file);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') return false;
      if (!LINK_UNSUPPORTED.has(code ?? '')) throw e;
      try {
        await fsp.writeFile(file, payload, { encoding: 'utf8', flag: 'wx' });
        return true;
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw e2;
      }
    }
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

async function removeLockIfOwned(file: string, token: string): Promise<void> {
  const snapshot = await readRestoreLock(file);
  if (!snapshot.exists || snapshot.holder?.token !== token) return;
  await fsp.rm(file, { force: true });
}

/**
 * Take `DATA_DIR/.restore.lock` for a cross-process restore.
 * A lock whose process is gone (or that is older than `staleMs`) is reclaimed;
 * a live one raises `RESTORE_TARGET_BUSY`.
 */
export async function acquireRestoreLock(
  dataDir: string,
  opts: RestoreLockOptions = {},
): Promise<RestoreLockHandle> {
  const file = path.join(path.resolve(dataDir), RESTORE_LOCK_NAME);
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? 30 * 60 * 1000;
  const graceMs = opts.graceMs ?? 60 * 1000;
  const holder: RestoreLockHolder = {
    pid: opts.pid ?? process.pid,
    startedAt: now,
    host: opts.host ?? os.hostname(),
    token: randomUUID(),
  };
  const payload = `${JSON.stringify(holder)}\n`;
  const handle = (): RestoreLockHandle => ({
    holder,
    release: () => removeLockIfOwned(file, holder.token),
  });

  await ensureDir(path.dirname(file));
  if (await createLockFile(file, payload)) return handle();

  let snapshot = await readRestoreLock(file);
  if (!snapshot.exists && (await createLockFile(file, payload))) return handle();
  const ageMs = snapshot.holder
    ? now - snapshot.holder.startedAt
    : Math.max(0, now - snapshot.mtimeMs);
  const stale = snapshot.holder
    ? !pidAlive(snapshot.holder.pid) || ageMs > staleMs
    : ageMs > graceMs;

  if (!stale) {
    throw new RestoreError(
      'RESTORE_TARGET_BUSY',
      `another restore is running (pid ${snapshot.holder?.pid ?? 'unknown'}, ${Math.round(ageMs / 1000)}s)`,
      `wait for it to finish, or remove ${RESTORE_LOCK_NAME} if its process is gone`,
    );
  }

  await fsp.rm(file, { force: true });
  if (await createLockFile(file, payload)) return handle();
  snapshot = await readRestoreLock(file);
  throw new RestoreError(
    'RESTORE_TARGET_BUSY',
    `another restore took the lock meanwhile (pid ${snapshot.holder?.pid ?? 'unknown'})`,
  );
}

// ── archive restore (admin_restore) ─────────────────────────────────

export interface ArchiveRestoreOptions {
  archive: string;
  dataDir: string;
  dryRun?: boolean;
  confirm?: string;
  prune?: boolean;
  includeSecrets?: boolean;
  staleLockMs?: number;
  now?: Date;
}

export interface ArchiveRestoreResult {
  dryRun: boolean;
  applied: boolean;
  archivePath: string;
  dataDir: string;
  applyToken?: string;
  entries: number;
  creates: RestorePlanItem[];
  overwrites: RestorePlanItem[];
  deletes: RestorePlanItem[];
  warnings: string[];
  manifest: {
    formatVersion: number;
    profile: string;
    schemaVersion: number;
    createdAt: string;
    containsSecrets: boolean;
  };
  snapshotDir?: string | null;
  filesRestored?: number;
  rolledBack?: boolean;
  irreversible: string[];
}

const IRREVERSIBLE_EFFECTS = [
  'webhooks and notifications already sent are not rolled back',
  'records in external databases are not touched (sqlite/postgres profiles are unsupported)',
];

function computeApplyToken(
  plan: RestorePlan,
  archivePath: string,
  archiveBytes: number,
  createdAt: string,
): string {
  return createHash('sha256')
    .update(`v1\n${plan.digest}\n${path.resolve(archivePath)}\n${archiveBytes}\n${createdAt}`)
    .digest('hex')
    .slice(0, 40);
}

/**
 * Restore a portable archive per ADR-008 §5: validate everything first, report
 * a plan by default, and on `confirm` replace the archived scope in DATA_DIR
 * (creates, overwrites, prunes) behind `.restore.lock` with a pre-restore
 * snapshot for rollback.
 */
export async function restoreArchive(opts: ArchiveRestoreOptions): Promise<ArchiveRestoreResult> {
  const dataDir = path.resolve(opts.dataDir);
  const archivePath = path.resolve(opts.archive);
  const dryRun = opts.dryRun !== false;
  const prune = opts.prune !== false;
  const includeSecrets = opts.includeSecrets === true;

  const initial = await readBackupArchive(archivePath);
  const initialPlan = await buildRestorePlan({
    dataDir,
    entries: initial.manifest.entries,
    prune,
    includeSecrets,
  });
  const token = computeApplyToken(
    initialPlan,
    archivePath,
    initial.archiveBytes,
    initial.manifest.createdAt,
  );
  const report: Omit<ArchiveRestoreResult, 'dryRun' | 'applied'> = {
    archivePath,
    dataDir,
    entries: initial.manifest.entries.length,
    creates: initialPlan.creates,
    overwrites: initialPlan.overwrites,
    deletes: initialPlan.deletes,
    warnings: initialPlan.warnings,
    manifest: {
      formatVersion: initial.manifest.formatVersion,
      profile: initial.manifest.profile,
      schemaVersion: initial.manifest.schemaVersion,
      createdAt: initial.manifest.createdAt,
      containsSecrets: initial.manifest.containsSecrets === true,
    },
    irreversible: [...IRREVERSIBLE_EFFECTS],
  };

  if (dryRun) {
    return { ...report, dryRun: true, applied: false, applyToken: token };
  }
  if (!opts.confirm || opts.confirm !== token) {
    throw new RestoreError(
      'RESTORE_CONFIRM_REQUIRED',
      'restore.confirm must equal the applyToken returned by a dry run of the same plan',
      'run admin_restore with dryRun=true (the default) and pass the returned applyToken back',
    );
  }

  return withFileLock(`restore:${dataDir}`, async () => {
    const lock = await acquireRestoreLock(dataDir, {
      now: opts.now?.getTime(),
      staleMs: opts.staleLockMs,
    });
    try {
      const current = await readBackupArchive(archivePath);
      const plan = await buildRestorePlan({
        dataDir,
        entries: current.manifest.entries,
        prune,
        includeSecrets,
      });
      const currentToken = computeApplyToken(
        plan,
        archivePath,
        current.archiveBytes,
        current.manifest.createdAt,
      );
      if (currentToken !== opts.confirm) {
        throw new RestoreError(
          'RESTORE_CONFIRM_REQUIRED',
          'DATA_DIR changed since the dry run; the plan is bound to the exact archive and target state',
          'run the dry run again and pass the new applyToken',
        );
      }

      let snapshotDir: string | null = null;
      let snapshotRoots: string[] = [];
      try {
        const snapshot = await createDataBackup({
          dataDir,
          tasksDir: path.join(dataDir, 'tasks'),
          knowledgeDir: path.join(dataDir, 'knowledge'),
          label: 'pre-restore',
          scope: 'full',
          includeSecrets: true,
          tool: 'admin_restore',
        });
        snapshotDir = snapshot?.backupDir ?? null;
        snapshotRoots = (snapshot?.manifest.paths ?? []).map((p) => p.to.split('/')[0]);
      } catch (e) {
        throw new RestoreError(
          'RESTORE_SNAPSHOT_FAILED',
          `pre-restore snapshot failed: ${(e as Error).message}`,
          'nothing was changed; make DATA_DIR/.backups writable and retry',
        );
      }

      const tmpRoot = path.join(dataDir, RESTORE_TMP_DIR_NAME);
      const tmpDir = path.join(tmpRoot, randomUUID());
      try {
        await readBackupArchive(archivePath, { extractTo: tmpDir });
        const { filesCount } = await applyRestorePlan(plan, tmpDir);
        log.info(
          { archivePath, dataDir, files: filesCount, deletes: plan.deletes.length, snapshotDir },
          'archive restored',
        );
        return {
          ...report,
          creates: plan.creates,
          overwrites: plan.overwrites,
          deletes: plan.deletes,
          dryRun: false,
          applied: true,
          snapshotDir,
          filesRestored: filesCount,
          rolledBack: false,
        };
      } catch (err) {
        const knownRoots = new Set(snapshotRoots);
        const rolledBack = await rollbackAfterFailure(plan, snapshotDir, knownRoots, dataDir);
        throw Object.assign(err as Error, { rolledBack });
      } finally {
        await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      }
    } finally {
      await lock.release();
    }
  });
}

async function rollbackAfterFailure(
  plan: RestorePlan,
  snapshotDir: string | null,
  snapshotRoots: Set<string>,
  dataDir: string,
): Promise<boolean> {
  if (!snapshotDir) return false;
  try {
    await restoreBackup(snapshotDir, { dataDir, includeSecrets: true, prune: true });
  } catch (rollbackErr) {
    log.error({ err: rollbackErr, snapshotDir }, 'restore failed AND rollback failed');
    return false;
  }
  const createdRoots = new Set<string>();
  for (const item of plan.creates) {
    const root = item.path.split('/')[0];
    if (snapshotRoots.has(root)) continue;
    createdRoots.add(root);
    await removeTarget(resolveUnderPath(dataDir, item.path)).catch(() => {});
  }
  for (const root of createdRoots) {
    await fsp.rmdir(resolveUnderPath(dataDir, root)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOTEMPTY' && e.code !== 'ENOENT') throw e;
    });
  }
  return true;
}

