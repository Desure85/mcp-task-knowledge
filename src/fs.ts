import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Create a directory (and parents) if missing — idempotent. */
export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Read a JSON file and parse it. Throws on missing file or invalid JSON. */
export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Unique sibling tmp path. `pid + Date.now()` alone collides when two writers
 * target the same file within one millisecond: the second rename then fails
 * with ENOENT because the first already moved the shared tmp file.
 */
function tmpPathFor(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
}

/**
 * Atomically write a JSON file (tmp + rename) so a crash/ENOSPC mid-write
 * never corrupts the existing file (Q-013). Cleans the tmp file on failure.
 */
export async function writeJson(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = tmpPathFor(filePath);
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // Clean up the tmp file so a failed write leaves no debris
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

const fileLocks = new Map<string, Promise<void>>();

/**
 * Serialize async read-modify-write cycles per key (AUD-18c). Without it two
 * concurrent updates both read the same snapshot and the later write silently
 * drops the earlier change. In-process only: several server processes sharing
 * one DATA_DIR are not coordinated.
 */
export async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = prev.then(() => mine);
  fileLocks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileLocks.get(key) === tail) fileLocks.delete(key);
  }
}

/** Whether a file/dir exists. Never throws. */
export async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Read a UTF-8 text file. */
export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Write a UTF-8 text file atomically (tmp + rename, creates parent dirs) so a
 * crash mid-write never leaves a truncated knowledge doc (AUD-18f).
 */
export async function writeText(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = tmpPathFor(filePath);
  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/** Synchronous variant of the atomic write for stores that persist inline (AUD-18b). */
export function writeFileAtomicSync(filePath: string, content: string) {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = tmpPathFor(filePath);
  try {
    fsSync.writeFileSync(tmpPath, content, 'utf-8');
    fsSync.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fsSync.rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

// ── Path traversal guards (AUD-03) ──────────────────────────────────

/** Thrown when a user-supplied path segment would escape its base dir. */
export class PathValidationError extends Error {
  constructor(
    message: string,
    readonly segment?: string,
  ) {
    super(message);
    this.name = 'PathValidationError';
  }
}

function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * A single path segment must not traverse: reject empty, '.', '..',
 * any path separator and control chars. Charset itself stays permissive —
 * existing ids/projects with dots or unicode keep working (the boundary
 * check in resolveUnder is the hard guarantee).
 */
export function assertSafeSegment(value: unknown, label = 'path segment'): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PathValidationError(`${label} must be a non-empty string`);
  }
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\') || hasControlChars(value)) {
    throw new PathValidationError(`${label} contains forbidden characters`, value);
  }
}

/**
 * Resolve segments under base and verify the result stays inside base.
 * Use for every user-controlled segment joined onto a DATA_DIR path.
 */
export function resolveUnder(base: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(base);
  for (const s of segments) assertSafeSegment(s);
  const resolved = path.resolve(resolvedBase, ...segments);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new PathValidationError(`path escapes base directory`, segments.join('/'));
  }
  return resolved;
}

/**
 * Like resolveUnder but the argument may be a relative path with
 * subdirectories (e.g. export filenames like "sub/dir/file.md"). Every
 * sub-segment is validated; '..' and absolute paths are rejected.
 */
export function resolveUnderPath(base: string, relPath: string): string {
  const resolvedBase = path.resolve(base);
  if (typeof relPath !== 'string' || relPath.length === 0 || path.isAbsolute(relPath)) {
    throw new PathValidationError('relative path must be a non-empty relative string', relPath);
  }
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) throw new PathValidationError('relative path is empty', relPath);
  for (const p of parts) assertSafeSegment(p, 'path component');
  const resolved = path.resolve(resolvedBase, ...parts);
  if (!resolved.startsWith(resolvedBase + path.sep)) {
    throw new PathValidationError('path escapes base directory', relPath);
  }
  return resolved;
}
