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
import { promises as fsp } from 'node:fs';
import { ensureDir, pathExists, writeJson, readJson } from '../fs.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('data-backup');

/** Directory inside DATA_DIR where snapshots are stored. */
export const BACKUPS_DIR_NAME = '.backups';

/** Manifest filename inside each backup dir. */
export const BACKUP_MANIFEST_FILE = 'manifest.json';

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

export interface RestoreResult {
  restored: Array<{ from: string; to: string }>;
  filesCount: number;
  dryRun: boolean;
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
    // Whole DATA_DIR minus the backups dir itself (and volatile dotfiles
    // that would be meaningless or harmful to restore: .embeddings cache).
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(opts.dataDir);
    } catch {
      return [];
    }
    for (const name of entries) {
      if (name === BACKUPS_DIR_NAME) continue;
      if (name === '.embeddings' || name === '.emb_cache') continue;
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

/**
 * Restore a backup: copy each manifest path back over its original
 * location under DATA_DIR. `dryRun` only reports what would be restored.
 *
 * This is a blunt instrument by design — it overwrites current files with
 * the snapshot. Callers decide when to invoke it; nothing calls it
 * automatically.
 */
export async function restoreBackup(
  backupDir: string,
  opts: { dryRun?: boolean } = {},
): Promise<RestoreResult> {
  const dryRun = opts.dryRun === true;
  const manifest = await readJson<BackupManifest>(path.join(backupDir, BACKUP_MANIFEST_FILE));
  if (!manifest || !Array.isArray(manifest.paths)) {
    throw new Error(`backup manifest missing or invalid in ${backupDir}`);
  }

  const restored: Array<{ from: string; to: string }> = [];
  let filesCount = 0;

  for (const entry of manifest.paths) {
    const src = path.join(backupDir, entry.to);
    const dst = entry.from;
    if (!(await pathExists(src))) {
      log.warn({ src }, 'restore: manifest path missing in backup, skipping');
      continue;
    }
    restored.push({ from: src, to: dst });
    if (dryRun) continue;

    const stat = await fsp.stat(src);
    if (stat.isDirectory()) {
      await copyDir(src, dst);
      filesCount += (await dirSizeAndCount(dst)).files;
    } else {
      await ensureDir(path.dirname(dst));
      await fsp.copyFile(src, dst);
      filesCount += 1;
    }
  }

  if (!dryRun) {
    log.info({ backupDir, restored: restored.length, filesCount }, 'backup restored');
  }
  return { restored, filesCount: dryRun ? manifest.filesCount : filesCount, dryRun };
}
