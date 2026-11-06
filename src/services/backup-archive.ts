/**
 * backup-archive.ts — portable DATA_DIR archive (DX-16a, ADR-008).
 *
 * Contract (docs/adr/0008-admin-backup-restore.md):
 *   - standard `tar.gz` (gzip over ustar/PAX, relative paths only);
 *   - `manifest.json` at the archive root with format/formatVersion/profile/
 *     schemaVersion/excluded/entries[].sha256;
 *   - own writer/reader on `node:zlib` — no new dependencies;
 *   - atomic write: `<name>.tar.gz.partial` renamed to `<name>.tar.gz`;
 *   - secrets (`.jwt-revoked.json`, `auth.db`) and caches never leave the
 *     machine unless `includeSecrets` is set;
 *   - the reader validates every entry (paths, types, sizes, checksums)
 *     BEFORE the caller writes a single byte to disk.
 *
 * Deliberate deviations from the ADR text (accepted by the owner, recorded in
 * docs/dev-cycle/decisions-log.md and in the ADR «Поправка» section):
 *   - `manifest.json` is written LAST in the tar stream, not first: tar
 *     headers carry the file size, and the manifest can only list hashes and
 *     sizes of files that have already been streamed. `manifest.json` still
 *     sits at the archive root.
 *   - `stats.archiveBytes` is not stored in the manifest (it cannot be known
 *     before the gzip stream is closed); the finished file size is returned
 *     by `createBackupArchive` and by the `admin_backup` tool.
 *
 * The archive is read-only with respect to DATA_DIR: the writer only reads
 * data files and writes the archive itself (default `DATA_DIR/.backups/`).
 * Symlinks are never followed and never archived; they are reported in
 * `manifest.warnings`.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { ensureDir, readJson } from '../fs.js';
import { CURRENT_SCHEMA, getPackageVersion } from './schema-version.js';

// ── format constants ────────────────────────────────────────────────

export const BACKUP_FORMAT = 'mcp-task-knowledge-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MANIFEST_NAME = 'manifest.json';
export const BACKUP_ARCHIVE_SUFFIX = '.tar.gz';
export const BACKUP_PARTIAL_SUFFIX = '.partial';

/** Directory inside DATA_DIR used when `out` is not given. */
export const BACKUP_OUT_DIR_NAME = '.backups';

/** Rules that always stay out of the archive, in manifest order. */
const BASE_EXCLUDED = ['.backups', '.embeddings', '.emb_cache', 'audit.log'] as const;
/** Rules that stay out unless `includeSecrets` is set. */
const SECRET_EXCLUDED = ['.jwt-revoked.json', 'auth.db'] as const;

const TAR_BLOCK = 512;
const MAX_ENTRY_PATH = 4096;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 200_000;
const COPY_CHUNK = 64 * 1024;

// ── errors ──────────────────────────────────────────────────────────

export type BackupErrorCode =
  | 'BACKUP_ARCHIVE_INVALID'
  | 'BACKUP_FORMAT_VERSION_UNSUPPORTED'
  | 'BACKUP_CHECKSUM_MISMATCH'
  | 'BACKUP_PATH_ESCAPE'
  | 'BACKUP_SYMLINK_REJECTED'
  | 'BACKUP_TOO_LARGE'
  | 'BACKUP_SCHEMA_TOO_NEW'
  | 'BACKUP_PROFILE_UNSUPPORTED'
  | 'BACKUP_NOT_FOUND';

/** Stable, machine-readable archive error (ADR-008 error table). */
export class BackupArchiveError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'BackupArchiveError';
  }
}

function fail(code: BackupErrorCode, message: string, hint?: string): never {
  throw new BackupArchiveError(code, message, hint);
}

// ── types ───────────────────────────────────────────────────────────

export type StorageProfile = 'files' | 'sqlite' | 'postgres';

export interface BackupEntry {
  /** Relative path inside the archive, '/' separated, never absolute. */
  path: string;
  type: 'file' | 'dir';
  /** Uncompressed bytes (0 for directories). */
  size: number;
  /** Hex sha256 of the file content (empty string for directories). */
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  createdBy: string;
  profile: string;
  schemaVersion: number;
  scope: 'full';
  /** True when `.jwt-revoked.json` / `auth.db` are inside the archive. */
  containsSecrets?: boolean;
  /** True because files are copied without a cross-file transaction. */
  live: true;
  warnings: string[];
  excluded: string[];
  entries: BackupEntry[];
  stats: { files: number; bytes: number; dirs: number };
}

export interface CreateArchiveOptions {
  /** Absolute DATA_DIR to archive. */
  dataDir: string;
  /** Output directory; default `<dataDir>/.backups`. */
  out?: string;
  /** Optional file-name suffix (sanitized, max 60 chars). */
  label?: string;
  /** Include `.jwt-revoked.json` and `auth.db` and flag the archive. */
  includeSecrets?: boolean;
  /** Skip the `models/` directory. */
  excludeModels?: boolean;
  /** Storage profile; anything but `files` is refused (ADR §7). */
  profile?: StorageProfile;
  /** Clock override — makes two runs byte-identical (tests). */
  now?: Date;
}

export interface BackupArchiveResult {
  archivePath: string;
  /** Size of the finished `.tar.gz` file. */
  bytes: number;
  files: number;
  manifest: {
    formatVersion: number;
    profile: string;
    schemaVersion: number;
    excluded: string[];
    containsSecrets: boolean;
  };
}

export interface ReadArchiveOptions {
  /** Extract validated entries into this directory (caller-owned, e.g. /tmp). */
  extractTo?: string;
  /** Cap on total uncompressed bytes; default BACKUP_MAX_MB (512). */
  maxBytes?: number;
  /** Cap on entry count; default 200 000. */
  maxEntries?: number;
}

export interface ReadArchiveResult {
  manifest: BackupManifest;
  entries: BackupEntry[];
  /** Size of the archive file itself. */
  archiveBytes: number;
}

interface WalkItem {
  rel: string;
  abs: string;
  type: 'file' | 'dir';
  size: number;
}

interface TarHeader {
  path: string;
  type: 'file' | 'dir';
  size: number;
}

interface EntrySink {
  write(chunk: Buffer): Promise<void>;
  end(): Promise<void>;
}

// ── small helpers ───────────────────────────────────────────────────

/** Filesystem-safe label: keep alnum/dash/underscore/dot, collapse the rest. */
function sanitizeLabel(label: string): string {
  const s = String(label ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s;
}

/** Timestamp that sorts lexicographically: 2026-09-12T13-45-30-123Z. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

function envMaxBytes(): number {
  const raw = process.env.BACKUP_MAX_MB;
  const mb = raw != null && raw !== '' ? Number(raw) : NaN;
  return (Number.isFinite(mb) && mb > 0 ? mb : 512) * 1024 * 1024;
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

async function readSchemaVersion(dataDir: string): Promise<{ version: number; warning?: string }> {
  const file = path.join(dataDir, '.schema-version');
  try {
    const raw = await readJson<{ schema?: unknown }>(file);
    if (typeof raw?.schema === 'number' && Number.isInteger(raw.schema) && raw.schema >= 0) {
      return { version: raw.schema };
    }
    return { version: 0, warning: 'unreadable .schema-version: recorded schemaVersion 0' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: 0 };
    return { version: 0, warning: 'unreadable .schema-version: recorded schemaVersion 0' };
  }
}

// ── walk (writer side) ──────────────────────────────────────────────

interface WalkResult {
  items: WalkItem[];
  excluded: string[];
  warnings: string[];
}

async function collectDataDir(
  dataDir: string,
  opts: { includeSecrets: boolean; excludeModels: boolean; skipAbs: Set<string> },
): Promise<WalkResult> {
  const excluded: string[] = [...BASE_EXCLUDED];
  if (!opts.includeSecrets) excluded.splice(3, 0, ...SECRET_EXCLUDED);
  if (opts.excludeModels) excluded.push('models');

  const topSkip = new Set(excluded);
  const items: WalkItem[] = [];
  const warnings: string[] = [];

  const walk = async (dir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (relDir === '') {
        fail('BACKUP_NOT_FOUND', `cannot read DATA_DIR: ${(err as Error).message}`);
      }
      warnings.push(`unreadable directory skipped: ${relDir || '.'}`);
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (relDir === '' && topSkip.has(entry.name)) continue;
      if (opts.skipAbs.has(path.resolve(abs))) continue;
      if (hasControlChars(entry.name)) {
        warnings.push(`skipped name with control characters: ${rel}`);
        continue;
      }
      const st = await fsp.lstat(abs);
      if (st.isSymbolicLink()) {
        warnings.push(`skipped symlink: ${rel}`);
        continue;
      }
      if (st.isDirectory()) {
        items.push({ rel, abs, type: 'dir', size: 0 });
        await walk(abs, rel);
        continue;
      }
      if (st.isFile()) {
        items.push({ rel, abs, type: 'file', size: st.size });
        continue;
      }
      warnings.push(`skipped non-regular file: ${rel}`);
    }
  };

  await walk(dataDir, '');
  items.sort((a, b) => comparePaths(a.rel, b.rel));
  return { items, excluded, warnings };
}

// ── tar writer ──────────────────────────────────────────────────────

function writeString(buf: Buffer, offset: number, width: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > width) throw new Error(`tar field overflow: ${value}`);
  bytes.copy(buf, offset);
}

function writeOctal(buf: Buffer, offset: number, width: number, value: number): void {
  const digits = value.toString(8);
  if (digits.length > width - 1) {
    fail('BACKUP_TOO_LARGE', `value ${value} does not fit a ${width}-byte tar field`);
  }
  writeString(buf, offset, width, `${digits.padStart(width - 1, '0')}\0`);
}

/**
 * Split a long path into ustar `prefix` + `name` fields. Returns null when the
 * path cannot be represented (then a PAX header is emitted instead).
 */
function splitUstar(name: string): { name: string; prefix: string } | null {
  if (byteLength(name) <= 100) return { name, prefix: '' };
  for (let i = name.length - 1; i > 0; i--) {
    if (name[i] !== '/') continue;
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (rest.length > 0 && byteLength(prefix) <= 155 && byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  return null;
}

function buildHeader(name: string, prefix: string, typeflag: '0' | '5' | 'x', size: number): Buffer {
  const buf = Buffer.alloc(TAR_BLOCK);
  writeString(buf, 0, 100, name);
  writeOctal(buf, 100, 8, typeflag === '5' ? 0o755 : 0o644);
  writeOctal(buf, 108, 8, 0); // uid
  writeOctal(buf, 116, 8, 0); // gid
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0); // mtime: fixed for reproducible archives
  buf.fill(0x20, 148, 156); // checksum field: spaces while summing
  writeString(buf, 156, 1, typeflag);
  writeString(buf, 257, 6, 'ustar\0');
  writeString(buf, 263, 2, '00');
  writeString(buf, 345, 155, prefix);
  let sum = 0;
  for (const b of buf) sum += b;
  writeString(buf, 148, 7, `${sum.toString(8).padStart(6, '0')}\0`);
  buf[155] = 0x20;
  return buf;
}

function padding(size: number): number {
  return (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let total = byteLength(body) + 1;
  for (;;) {
    const candidate = `${total}${body}`;
    const length = byteLength(candidate);
    if (length === total) return Buffer.from(candidate, 'utf8');
    total = length;
  }
}

function buildPaxEntry(entryPath: string): { header: Buffer; payload: Buffer } {
  const payload = paxRecord('path', entryPath);
  const header = buildHeader('PaxHeaders/entry', '', 'x', payload.length);
  return { header, payload };
}

/** Writer state shared with the generator: filled as the stream is consumed. */
interface WriterState {
  entries: BackupEntry[];
  files: number;
  bytes: number;
}

async function* archiveChunks(
  items: WalkItem[],
  base: Omit<BackupManifest, 'entries' | 'stats'>,
  state: WriterState,
): AsyncGenerator<Buffer> {
  const dirs = items.filter((i) => i.type === 'dir');
  const files = items.filter((i) => i.type === 'file');

  for (const dir of dirs) {
    const name = `${dir.rel}/`;
    const split = splitUstar(name);
    if (!split) {
      const pax = buildPaxEntry(name);
      yield pax.header;
      yield pax.payload;
      yield Buffer.alloc(padding(pax.payload.length));
    }
    yield buildHeader(split?.name ?? 'pax-dir', split?.prefix ?? '', '5', 0);
    state.entries.push({ path: dir.rel, type: 'dir', size: 0, sha256: '' });
  }

  for (const file of files) {
    const size = file.size;
    const split = splitUstar(file.rel);
    if (!split) {
      const pax = buildPaxEntry(file.rel);
      yield pax.header;
      yield pax.payload;
      yield Buffer.alloc(padding(pax.payload.length));
    }
    yield buildHeader(split?.name ?? 'pax-entry', split?.prefix ?? '', '0', size);

    const hash = createHash('sha256');
    let written = 0;
    if (size > 0) {
      for await (const chunk of createReadStream(file.abs, { start: 0, end: size - 1 })) {
        const buf = chunk as Buffer;
        written += buf.length;
        hash.update(buf);
        yield buf;
      }
    }
    // The file may have shrunk between stat and read (live DATA_DIR): pad to
    // the declared size so the tar stream stays well-formed and the hash
    // matches exactly the bytes stored in the archive.
    if (written < size) {
      const pad = Buffer.alloc(size - written);
      hash.update(pad);
      yield pad;
    }
    const padLen = padding(size);
    if (padLen > 0) yield Buffer.alloc(padLen);

    state.entries.push({ path: file.rel, type: 'file', size, sha256: hash.digest('hex') });
    state.files += 1;
    state.bytes += size;
  }

  const entries = [...state.entries].sort((a, b) => comparePaths(a.path, b.path));
  const manifest: BackupManifest = {
    ...base,
    entries,
    stats: { files: state.files, bytes: state.bytes, dirs: dirs.length },
  };
  const payload = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  yield buildHeader(BACKUP_MANIFEST_NAME, '', '0', payload.length);
  yield payload;
  const padLen = padding(payload.length);
  if (padLen > 0) yield Buffer.alloc(padLen);
  yield Buffer.alloc(TAR_BLOCK * 2); // end-of-archive marker
}

// ── public writer ───────────────────────────────────────────────────

/**
 * Build a portable `.tar.gz` archive of `DATA_DIR` per ADR-008.
 *
 * The archive is written to `<out>/backup-<timestamp>[-<label>].tar.gz` via a
 * `.partial` file and an atomic rename; a failed run leaves no archive behind.
 */
export async function createBackupArchive(opts: CreateArchiveOptions): Promise<BackupArchiveResult> {
  const profile = opts.profile ?? 'files';
  if (profile !== 'files') {
    fail(
      'BACKUP_PROFILE_UNSUPPORTED',
      `storage profile "${profile}" is not supported by admin_backup`,
      'use the database-native dump (pg_dump / .backup) and migrate-storage (Y-08); users: profile export',
    );
  }

  const dataDir = path.resolve(opts.dataDir);
  const now = opts.now ?? new Date();
  const outDir = path.resolve(opts.out ?? path.join(dataDir, BACKUP_OUT_DIR_NAME));

  const label = opts.label ? sanitizeLabel(opts.label) : '';
  const fileName = `backup-${stamp(now)}${label ? `-${label}` : ''}${BACKUP_ARCHIVE_SUFFIX}`;
  const archivePath = path.join(outDir, fileName);
  const partialPath = `${archivePath}${BACKUP_PARTIAL_SUFFIX}`;

  const skipAbs = new Set([path.resolve(archivePath), path.resolve(partialPath)]);
  const walk = await collectDataDir(dataDir, {
    includeSecrets: opts.includeSecrets === true,
    excludeModels: opts.excludeModels === true,
    skipAbs,
  });

  const schema = await readSchemaVersion(dataDir);
  const warnings = [...walk.warnings];
  if (schema.warning) warnings.push(schema.warning);
  warnings.push('files may have changed during copy: backup is not a cross-file transaction');

  const base: Omit<BackupManifest, 'entries' | 'stats'> = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    createdBy: `mcp-task-knowledge@${await getPackageVersion()}`,
    profile,
    schemaVersion: schema.version,
    scope: 'full',
    ...(opts.includeSecrets ? { containsSecrets: true } : {}),
    live: true,
    warnings,
    excluded: walk.excluded,
  };

  const state: WriterState = { entries: [], files: 0, bytes: 0 };

  await ensureDir(outDir);
  try {
    await pipeline(
      Readable.from(archiveChunks(walk.items, base, state)),
      createGzip(),
      createWriteStream(partialPath, { flags: 'wx' }),
    );
    await fsp.rename(partialPath, archivePath);
  } catch (err) {
    await fsp.rm(partialPath, { force: true }).catch(() => {});
    if (err instanceof BackupArchiveError) throw err;
    throw new BackupArchiveError('BACKUP_ARCHIVE_INVALID', `failed to write archive: ${(err as Error).message}`);
  }

  const stat = await fsp.stat(archivePath);
  return {
    archivePath,
    bytes: stat.size,
    files: state.files,
    manifest: {
      formatVersion: BACKUP_FORMAT_VERSION,
      profile,
      schemaVersion: schema.version,
      excluded: walk.excluded,
      containsSecrets: opts.includeSecrets === true,
    },
  };
}

// ── tar reader ──────────────────────────────────────────────────────

/** Buffered reader over a decompressed tar stream (no whole-file buffering). */
class ByteReader {
  private chunks: Buffer[] = [];
  private length = 0;
  private ended = false;
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(stream: AsyncIterable<Buffer>) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async fill(n: number): Promise<void> {
    while (this.length < n && !this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        return;
      }
      const chunk = next.value as Buffer;
      if (chunk.length === 0) continue;
      this.chunks.push(chunk);
      this.length += chunk.length;
    }
  }

  private take(n: number): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.length);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length > 0 ? [rest] : [];
    this.length = rest.length;
    return out;
  }

  /** Read exactly `n` bytes; at a clean boundary return null when `allowEof`. */
  async read(n: number, allowEof = false): Promise<Buffer | null> {
    await this.fill(n);
    if (this.length < n) {
      if (allowEof && this.length === 0) return null;
      fail('BACKUP_ARCHIVE_INVALID', 'truncated tar stream');
    }
    return this.take(n);
  }

  async readExactly(n: number): Promise<Buffer> {
    const buf = await this.read(n);
    return buf as Buffer;
  }
}

function parseOctalField(buf: Buffer): number {
  const text = buf.toString('ascii').replace(/\0.*$/, '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) fail('BACKUP_ARCHIVE_INVALID', `invalid octal field: ${text}`);
  return parseInt(text, 8);
}

/** GNU base-256 numeric field (large sizes). */
function parseNumericField(buf: Buffer): number {
  if (buf.length > 0 && (buf[0] & 0x80) !== 0) {
    let value = buf[0] & 0x7f;
    for (let i = 1; i < buf.length; i++) value = value * 256 + buf[i];
    return value;
  }
  return parseOctalField(buf);
}

function isZeroBlock(block: Buffer): boolean {
  for (const b of block) if (b !== 0) return false;
  return true;
}

function assertArchivePath(p: string): void {
  if (p.length === 0 || p.length > MAX_ENTRY_PATH) {
    fail('BACKUP_PATH_ESCAPE', `archive path length out of range: ${p.length}`);
  }
  if (p.includes('\0') || p.includes('\\') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
    fail('BACKUP_PATH_ESCAPE', `archive path is absolute or contains forbidden characters: ${p}`);
  }
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      fail('BACKUP_PATH_ESCAPE', `archive path escapes the extraction root: ${p}`);
    }
  }
}

interface RawHeader {
  path: string;
  typeflag: string;
  size: number;
}

function parseHeaderBlock(block: Buffer): RawHeader {
  const stored = parseOctalField(block.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : block[i];
  }
  if (stored !== sum) fail('BACKUP_ARCHIVE_INVALID', 'tar header checksum mismatch');

  const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
  const name = prefix ? `${prefix}/${rawName}` : rawName;
  const typeflag = String.fromCharCode(block[156]);
  const size = parseNumericField(block.subarray(124, 136));
  return { path: name, typeflag, size };
}

function parsePaxPayload(payload: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset);
    if (space < 0) break;
    const len = Number(payload.subarray(offset, space).toString('ascii'));
    if (!Number.isFinite(len) || len <= 0 || offset + len > payload.length) {
      fail('BACKUP_ARCHIVE_INVALID', 'invalid PAX record length');
    }
    const record = payload.subarray(space + 1, offset + len).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) {
      const key = record.slice(0, eq);
      const value = record.slice(eq + 1).replace(/\n$/, '');
      out[key] = value;
    }
    offset += len;
  }
  return out;
}

/**
 * Parse a tar stream entry by entry. `onEntry` returns a sink that receives
 * the entry content and an `end()` called after the content is consumed.
 */
async function scanTar(
  stream: AsyncIterable<Buffer>,
  onEntry: (header: TarHeader) => Promise<EntrySink>,
): Promise<void> {
  const reader = new ByteReader(stream);
  let pendingPath: string | undefined;
  let pendingSize: number | undefined;

  for (;;) {
    const block = await reader.read(TAR_BLOCK, true);
    if (!block) return;
    if (isZeroBlock(block)) {
      await reader.read(TAR_BLOCK, true);
      return;
    }

    const raw = parseHeaderBlock(block);
    const flag = raw.typeflag === '\0' ? '0' : raw.typeflag;

    if (flag === 'x' || flag === 'g' || flag === 'L' || flag === 'K') {
      if (raw.size > MAX_MANIFEST_BYTES) {
        fail('BACKUP_TOO_LARGE', `metadata entry too large: ${raw.size} bytes`);
      }
      const payload = await reader.readExactly(raw.size);
      const padLen = padding(raw.size);
      if (padLen > 0) await reader.readExactly(padLen);
      if (flag === 'x' || flag === 'g') {
        const records = parsePaxPayload(payload);
        if (records.path !== undefined) pendingPath = records.path;
        if (records.size !== undefined) pendingSize = Number(records.size);
      } else if (flag === 'L') {
        pendingPath = payload.toString('utf8').replace(/\0+$/, '');
      }
      continue;
    }

    if (flag !== '0' && flag !== '5') {
      // hardlink, symlink, char/block device, fifo, contiguous — all refused.
      fail(
        'BACKUP_SYMLINK_REJECTED',
        `archive entry "${pendingPath ?? raw.path}" has unsupported type "${flag}"`,
        'only regular files and directories are allowed in a backup archive',
      );
    }

    let entryPath = pendingPath ?? raw.path;
    const size = pendingSize ?? raw.size;
    pendingPath = undefined;
    pendingSize = undefined;
    // tar directory entries conventionally end with '/'; the manifest stores
    // the path without it.
    if (flag === '5') entryPath = entryPath.replace(/\/+$/, '');

    assertArchivePath(entryPath);
    const header: TarHeader = { path: entryPath, type: flag === '5' ? 'dir' : 'file', size };

    const sink = await onEntry(header);
    let remaining = size;
    while (remaining > 0) {
      const chunk = await reader.readExactly(Math.min(remaining, COPY_CHUNK));
      await sink.write(chunk);
      remaining -= chunk.length;
    }
    const padLen = padding(size);
    if (padLen > 0) await reader.readExactly(padLen);
    await sink.end();
  }
}

function invalidArchive(message: string): BackupArchiveError {
  return new BackupArchiveError('BACKUP_ARCHIVE_INVALID', message);
}

interface ScanResult {
  manifest: BackupManifest;
  entries: BackupEntry[];
}

async function scanArchive(archivePath: string, maxBytes: number, maxEntries: number): Promise<ScanResult> {
  const entries: BackupEntry[] = [];
  const manifestChunks: Buffer[] = [];
  let manifestSeen = false;
  let totalBytes = 0;

  try {
    await pipeline(createReadStream(archivePath), createGunzip(), async (stream: AsyncIterable<Buffer>) => {
      await scanTar(stream, async (header) => {
        if (header.path === BACKUP_MANIFEST_NAME) {
          if (header.type !== 'file') fail('BACKUP_ARCHIVE_INVALID', 'manifest.json is not a regular file');
          if (manifestSeen) fail('BACKUP_ARCHIVE_INVALID', 'manifest.json appears more than once');
          if (header.size > MAX_MANIFEST_BYTES) fail('BACKUP_TOO_LARGE', 'manifest.json is too large');
          manifestSeen = true;
          return {
            write: async (chunk) => {
              manifestChunks.push(chunk);
            },
            end: async () => {},
          };
        }
        if (entries.length >= maxEntries) {
          fail('BACKUP_TOO_LARGE', `archive has more than ${maxEntries} entries`);
        }
        totalBytes += header.size;
        if (totalBytes > maxBytes) {
          fail('BACKUP_TOO_LARGE', `archive expands to more than ${maxBytes} bytes`, 'raise BACKUP_MAX_MB to allow it');
        }
        if (header.type === 'dir') {
          entries.push({ path: header.path, type: 'dir', size: 0, sha256: '' });
          return { write: async () => {}, end: async () => {} };
        }
        const hash = createHash('sha256');
        return {
          write: async (chunk) => {
            hash.update(chunk);
          },
          end: async () => {
            entries.push({ path: header.path, type: 'file', size: header.size, sha256: hash.digest('hex') });
          },
        };
      });
    });
  } catch (err) {
    if (err instanceof BackupArchiveError) throw err;
    throw invalidArchive(`not a valid gzip/tar archive: ${(err as Error).message}`);
  }

  if (!manifestSeen) fail('BACKUP_ARCHIVE_INVALID', 'manifest.json is missing from the archive');

  let parsed: BackupManifest;
  try {
    parsed = JSON.parse(Buffer.concat(manifestChunks).toString('utf8')) as BackupManifest;
  } catch {
    throw invalidArchive('manifest.json is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || parsed.format !== BACKUP_FORMAT) {
    throw invalidArchive(`manifest.format must be "${BACKUP_FORMAT}"`);
  }
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    fail(
      'BACKUP_FORMAT_VERSION_UNSUPPORTED',
      `unsupported archive formatVersion ${String(parsed.formatVersion)}`,
      `this build reads formatVersion ${BACKUP_FORMAT_VERSION} only`,
    );
  }
  if (parsed.profile !== 'files') {
    fail(
      'BACKUP_PROFILE_UNSUPPORTED',
      `archive was taken from storage profile "${String(parsed.profile)}"`,
      'restore this archive with the database-native tools of that profile',
    );
  }
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > CURRENT_SCHEMA) {
    fail(
      'BACKUP_SCHEMA_TOO_NEW',
      `archive schemaVersion ${parsed.schemaVersion} is newer than this build (${CURRENT_SCHEMA})`,
      'upgrade the package before restoring this archive',
    );
  }
  if (!Array.isArray(parsed.entries)) throw invalidArchive('manifest.entries must be an array');

  const listed = new Map<string, BackupEntry>();
  for (const entry of parsed.entries) {
    if (!entry || typeof entry.path !== 'string') throw invalidArchive('manifest entry without path');
    assertArchivePath(entry.path);
    if (entry.type !== 'file' && entry.type !== 'dir') {
      throw invalidArchive(`manifest entry "${entry.path}" has unknown type`);
    }
    if (listed.has(entry.path)) throw invalidArchive(`duplicate manifest entry "${entry.path}"`);
    listed.set(entry.path, entry);
  }

  const actual = new Map(entries.map((e) => [e.path, e]));
  for (const [p, entry] of actual) {
    const want = listed.get(p);
    if (!want) throw invalidArchive(`archive entry "${p}" is not listed in manifest.json`);
    if (want.type !== entry.type) throw invalidArchive(`archive entry "${p}" type differs from manifest`);
    if (want.size !== entry.size) throw invalidArchive(`archive entry "${p}" size differs from manifest`);
    if (entry.type === 'file' && want.sha256 !== entry.sha256) {
      fail('BACKUP_CHECKSUM_MISMATCH', `sha256 mismatch for "${p}"`);
    }
  }
  for (const p of listed.keys()) {
    if (!actual.has(p)) throw invalidArchive(`manifest entry "${p}" is missing from the archive`);
  }

  return { manifest: parsed, entries };
}

function resolveExtractPath(destDir: string, relPath: string): string {
  assertArchivePath(relPath);
  const resolvedBase = path.resolve(destDir);
  const resolved = path.resolve(resolvedBase, ...relPath.split('/'));
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    fail('BACKUP_PATH_ESCAPE', `archive path escapes the extraction root: ${relPath}`);
  }
  return resolved;
}

async function extractValidated(archivePath: string, destDir: string): Promise<void> {
  await ensureDir(destDir);

  try {
    await pipeline(createReadStream(archivePath), createGunzip(), async (stream: AsyncIterable<Buffer>) => {
      await scanTar(stream, async (header) => {
        const target = resolveExtractPath(destDir, header.path);
        if (header.type === 'dir') {
          await ensureDir(target);
          return { write: async () => {}, end: async () => {} };
        }
        await ensureDir(path.dirname(target));
        const handle = await fsp.open(target, 'w');
        return {
          write: async (chunk) => {
            await handle.write(chunk);
          },
          end: async () => {
            await handle.close();
          },
        };
      });
    });
  } catch (err) {
    if (err instanceof BackupArchiveError) throw err;
    throw invalidArchive(`failed to extract archive: ${(err as Error).message}`);
  }
}

// ── public reader ───────────────────────────────────────────────────

/**
 * Read and validate a backup archive. Nothing is written unless `extractTo`
 * is set; extraction happens only after the whole archive has been validated.
 */
export async function readBackupArchive(
  archivePath: string,
  opts: ReadArchiveOptions = {},
): Promise<ReadArchiveResult> {
  const abs = path.resolve(archivePath);
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch (err) {
    fail('BACKUP_NOT_FOUND', `archive not found: ${abs}`, (err as Error).message);
  }
  if (!stat.isFile()) fail('BACKUP_NOT_FOUND', `not a file: ${abs}`);

  const maxBytes = opts.maxBytes ?? envMaxBytes();
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const { manifest, entries } = await scanArchive(abs, maxBytes, maxEntries);

  if (opts.extractTo) {
    await extractValidated(abs, path.resolve(opts.extractTo));
  }

  return { manifest, entries, archiveBytes: stat.size };
}
