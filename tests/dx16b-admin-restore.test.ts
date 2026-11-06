/**
 * DX-16b — admin_restore and the hardened legacy restore.
 *
 * Every test here fails if the corresponding fix is reverted: the mapping is
 * defect Д1-Д6 / ADR-008 contract -> test name.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {
  acquireRestoreLock,
  restoreArchive,
  restoreBackup,
  RestoreError,
  BACKUPS_DIR_NAME,
  RESTORE_LOCK_NAME,
  SERVER_LOCK_NAME,
} from '../src/services/data-backup.js';
import {
  createBackupArchive,
  readBackupArchive,
  BackupArchiveError,
} from '../src/services/backup-archive.js';

let ROOT: string;
let DATA: string;

async function write(rel: string, content: string | Buffer): Promise<void> {
  const abs = path.join(DATA, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

async function read(rel: string): Promise<string> {
  return fsp.readFile(path.join(DATA, rel), 'utf8');
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function seed(): Promise<void> {
  await write('tasks/acme/t1.json', '{"id":"t1","title":"one"}\n');
  await write('tasks/acme/t2.json', '{"id":"t2","title":"two"}\n');
  await write('knowledge/acme/d1.md', '---\nid: d1\n---\nbody one\n');
  await write('projects/acme.json', '{"id":"acme"}\n');
  await write('memory/layers.json', '{"layers":[]}\n');
  await write('prompts/p1.json', '{"id":"p1"}\n');
  await write('models/gemma/model.onnx', 'onnx-bytes');
  await write('stopwords.txt', 'and\n');
  await write('.state.json', '{"current":"acme"}\n');
  await write('.schema-version', '{"schema":1,"updatedAt":"x","updatedBy":"y"}\n');
  await write('.jwt-revoked.json', '{"revoked":["rev-before"]}\n');
  await write('auth.db', 'sqlite-bytes');
  await write('.embeddings/cache.bin', 'cache\n');
}

async function inventory(skip: (rel: string) => boolean = () => false): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string, relDir: string): Promise<void> => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, rel);
      else if (entry.isFile() && !skip(rel)) {
        out.set(rel, createHash('sha256').update(await fsp.readFile(abs)).digest('hex'));
      }
    }
  };
  await walk(DATA, '');
  return out;
}

const runtimeSkip = (rel: string): boolean =>
  rel.startsWith(`${BACKUPS_DIR_NAME}/`) || rel.startsWith('.restore-tmp/');

async function prepare(): Promise<{ archive: string; originals: Map<string, string> }> {
  await seed();
  const originals = await inventory(runtimeSkip);
  const result = await createBackupArchive({ dataDir: DATA, label: 'dx16b' });
  return { archive: result.archivePath, originals };
}

async function mutate(): Promise<void> {
  await write('tasks/acme/t1.json', '{"id":"t1","title":"CHANGED"}\n');
  await write('knowledge/acme/d2-added-after-backup.md', 'after\n');
  await fsp.rm(path.join(DATA, 'knowledge/acme/d1.md'));
}

async function applyRestore(archive: string, extra: Record<string, unknown> = {}) {
  const plan = await restoreArchive({ archive, dataDir: DATA, ...extra });
  const applied = await restoreArchive({
    archive,
    dataDir: DATA,
    dryRun: false,
    confirm: plan.applyToken,
    ...extra,
  });
  return { plan, applied };
}

async function expectArchiveCode(fn: () => Promise<unknown>, code: string): Promise<BackupArchiveError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BackupArchiveError);
    const err = e as BackupArchiveError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

async function expectRestoreCode(fn: () => Promise<unknown>, code: string): Promise<RestoreError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RestoreError);
    const err = e as RestoreError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}


// ── raw tar fixtures for hostile archives ───────────────────────────

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function rawHeader(name: string, size: number, typeflag = '0'): Buffer {
  const buf = Buffer.alloc(512);
  buf.write(name.slice(0, 100), 0, 100, 'utf8');
  buf.write(octal(0o644, 8), 100, 'ascii');
  buf.write(octal(0, 8), 108, 'ascii');
  buf.write(octal(0, 8), 116, 'ascii');
  buf.write(octal(size, 12), 124, 'ascii');
  buf.write(octal(0, 12), 136, 'ascii');
  buf.fill(0x20, 148, 156);
  buf.write(typeflag, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

interface RawEntry {
  name: string;
  content?: string;
  typeflag?: string;
}

function manifestFor(entries: RawEntry[]): Record<string, unknown> {
  const listed = entries
    .filter((e) => (e.typeflag ?? '0') === '0' || e.typeflag === '5')
    .map((e) => ({
      path: e.name.replace(/\/$/, ''),
      type: e.typeflag === '5' ? 'dir' : 'file',
      size: Buffer.byteLength(e.content ?? ''),
      sha256: createHash('sha256').update(e.content ?? '').digest('hex'),
    }));
  return {
    format: 'mcp-task-knowledge-backup',
    formatVersion: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    createdBy: 'test',
    profile: 'files',
    schemaVersion: 1,
    scope: 'full',
    live: true,
    warnings: [],
    excluded: [],
    entries: listed,
    stats: { files: listed.filter((e) => e.type === 'file').length, bytes: 0, dirs: 0 },
  };
}

async function rawArchive(name: string, entries: RawEntry[]): Promise<string> {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? '');
    blocks.push(rawHeader(entry.name, entry.typeflag === '0' || !entry.typeflag ? content.length : 0, entry.typeflag ?? '0'));
    if ((entry.typeflag ?? '0') === '0') {
      blocks.push(content);
      const pad = (512 - (content.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }
  const manifest = Buffer.from(JSON.stringify(manifestFor(entries)), 'utf8');
  blocks.push(rawHeader('manifest.json', manifest.length));
  blocks.push(manifest);
  const pad = (512 - (manifest.length % 512)) % 512;
  if (pad > 0) blocks.push(Buffer.alloc(pad));
  blocks.push(Buffer.alloc(1024));
  const file = path.join(ROOT, `${name}.tar.gz`);
  await fsp.writeFile(file, gzipSync(Buffer.concat(blocks)));
  return file;
}

beforeEach(async () => {
  ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'dx16b-restore-'));
  DATA = path.join(ROOT, 'data');
  await fsp.mkdir(DATA, { recursive: true });
  delete process.env.BACKUP_MAX_MB;
  delete process.env.BACKUP_KEEP;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(ROOT, { recursive: true, force: true });
  delete process.env.BACKUP_MAX_MB;
  delete process.env.BACKUP_KEEP;
});

describe('restoreArchive round-trip', () => {
  it('backup -> mutate -> restore --confirm gives byte-identical data and prunes additions', async () => {
    const { archive, originals } = await prepare();
    await mutate();

    const { plan, applied } = await applyRestore(archive);
    expect(plan.dryRun).toBe(true);
    expect(plan.applied).toBe(false);
    expect(plan.applyToken).toBeTruthy();
    expect(plan.deletes.map((d) => d.path)).toContain('knowledge/acme/d2-added-after-backup.md');
    expect(applied.dryRun).toBe(false);
    expect(applied.applied).toBe(true);
    expect(applied.snapshotDir).toContain('-pre-restore');

    const after = await inventory(runtimeSkip);
    expect(after).toEqual(originals);
    expect(await exists(path.join(DATA, 'knowledge/acme/d2-added-after-backup.md'))).toBe(false);
    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"one"}\n');
  });

  it('dry run reports the plan and writes nothing at all', async () => {
    const { archive } = await prepare();
    await mutate();
    const before = await inventory();
    const snapshotsBefore = (await fsp.readdir(path.join(DATA, BACKUPS_DIR_NAME))).sort();

    const plan = await restoreArchive({ archive, dataDir: DATA });
    expect(plan.creates.length + plan.overwrites.length + plan.deletes.length).toBeGreaterThan(0);

    expect(await inventory()).toEqual(before);
    expect((await fsp.readdir(path.join(DATA, BACKUPS_DIR_NAME))).sort()).toEqual(snapshotsBefore);
    expect(await exists(path.join(DATA, RESTORE_LOCK_NAME))).toBe(false);
    expect(await exists(path.join(DATA, '.restore-tmp'))).toBe(false);
  });

  it('without a valid confirm nothing is applied', async () => {
    const { archive } = await prepare();
    await mutate();
    await expectRestoreCode(
      () => restoreArchive({ archive, dataDir: DATA, dryRun: false }),
      'RESTORE_CONFIRM_REQUIRED',
    );
    await expectRestoreCode(
      () => restoreArchive({ archive, dataDir: DATA, dryRun: false, confirm: 'wrong-token' }),
      'RESTORE_CONFIRM_REQUIRED',
    );
    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"CHANGED"}\n');
    expect(await exists(path.join(DATA, 'knowledge/acme/d2-added-after-backup.md'))).toBe(true);
  });
});

describe('path containment (Д1, ADR §6)', () => {
  it('a tampered legacy manifest cannot write outside DATA_DIR', async () => {
    await seed();
    const snapshot = await (await import('../src/services/data-backup.js')).createDataBackup({
      dataDir: DATA,
      tasksDir: path.join(DATA, 'tasks'),
      knowledgeDir: path.join(DATA, 'knowledge'),
      label: 'legacy',
      scope: 'project',
      project: 'acme',
    });
    const manifestFile = path.join(snapshot!.backupDir, 'manifest.json');
    const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
    const evil = path.join(ROOT, 'outside', 'written-outside.json');
    manifest.paths.push({ from: evil, to: 'tasks/acme/t1.json' });
    await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2));

    await fsp.rm(path.join(DATA, 'tasks/acme'), { recursive: true });
    await restoreBackup(snapshot!.backupDir);
    expect(await exists(evil)).toBe(false);
    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"one"}\n');
  });

  it('an archive entry with ../ or an absolute path is refused before any write', async () => {
    await seed();
    const traversal = await rawArchive('traversal', [
      { name: 'tasks/../../evil.txt', content: 'evil' },
    ]);
    await expectArchiveCode(
      () => restoreArchive({ archive: traversal, dataDir: DATA }),
      'BACKUP_PATH_ESCAPE',
    );
    const absolute = await rawArchive('absolute', [{ name: '/tmp/evil-absolute.txt', content: 'evil' }]);
    await expectArchiveCode(
      () => restoreArchive({ archive: absolute, dataDir: DATA }),
      'BACKUP_PATH_ESCAPE',
    );
    expect(await exists(path.join(ROOT, 'evil.txt'))).toBe(false);
    expect(await exists('/tmp/evil-absolute.txt')).toBe(false);
  });
});

describe('symlinks (Д2, ADR §6)', () => {
  it('an archive symlink entry is rejected and nothing is extracted', async () => {
    await seed();
    const archive = await rawArchive('symlink', [
      { name: 'knowledge/acme/link', typeflag: '2' },
    ]);
    await expectArchiveCode(
      () => readBackupArchive(archive, { extractTo: path.join(ROOT, 'extract-symlink') }),
      'BACKUP_SYMLINK_REJECTED',
    );
    expect(await exists(path.join(ROOT, 'extract-symlink', 'knowledge/acme/link'))).toBe(false);
  });

  it('a symlink inside a legacy snapshot is skipped, not recreated', async () => {
    await seed();
    const { createDataBackup } = await import('../src/services/data-backup.js');
    const snapshot = await createDataBackup({
      dataDir: DATA,
      tasksDir: path.join(DATA, 'tasks'),
      knowledgeDir: path.join(DATA, 'knowledge'),
      label: 'with-link',
      scope: 'full',
      includeSecrets: true,
    });
    await fsp.symlink('/etc/hostname', path.join(snapshot!.backupDir, 'knowledge/acme/link-out'));
    await fsp.rm(path.join(DATA, 'knowledge/acme/link-out'), { force: true });

    const result = await restoreBackup(snapshot!.backupDir, { dataDir: DATA });
    expect(result.warnings.some((w) => w.includes('symlink skipped: knowledge/acme/link-out'))).toBe(true);
    const st = await fsp.lstat(path.join(DATA, 'knowledge/acme/link-out')).catch(() => null);
    expect(st).toBeNull();
  });
});

describe('secrets (Д3/Д4, ADR §3)', () => {
  it('a revocation made after the backup survives restore', async () => {
    await seed();
    const { createDataBackup } = await import('../src/services/data-backup.js');
    const snapshot = await createDataBackup({
      dataDir: DATA,
      tasksDir: path.join(DATA, 'tasks'),
      knowledgeDir: path.join(DATA, 'knowledge'),
      label: 'secrets-snapshot',
      scope: 'full',
      includeSecrets: true,
    });
    await write('.jwt-revoked.json', '{"revoked":["rev-before","rev-after"]}\n');

    const result = await restoreBackup(snapshot!.backupDir, { dataDir: DATA });
    expect(result.warnings.some((w) => w.includes('.jwt-revoked.json'))).toBe(true);
    expect(await read('.jwt-revoked.json')).toContain('rev-after');
  });

  it('a secrets archive is not applied without includeSecrets, and is with it', async () => {
    await seed();
    const result = await createBackupArchive({ dataDir: DATA, label: 'secrets', includeSecrets: true });
    await write('.jwt-revoked.json', '{"revoked":["rev-after"]}\n');

    await applyRestore(result.archivePath);
    expect(await read('.jwt-revoked.json')).toContain('rev-after');

    await applyRestore(result.archivePath, { includeSecrets: true });
    expect(await read('.jwt-revoked.json')).toContain('rev-before');
    expect(await read('.jwt-revoked.json')).not.toContain('rev-after');
  });
});

describe('prune scope (Д4, ADR §5)', () => {
  it('deletes only files under the archived roots', async () => {
    const { archive } = await prepare();
    await write('knowledge/acme/d2-added-after-backup.md', 'after\n');
    await write('outside-scope/keep.txt', 'keep\n');
    await write('.embeddings/cache-2.bin', 'cache\n');
    await write(`${BACKUPS_DIR_NAME}/marker.txt`, 'marker\n');

    await applyRestore(archive);
    expect(await exists(path.join(DATA, 'knowledge/acme/d2-added-after-backup.md'))).toBe(false);
    expect(await read('outside-scope/keep.txt')).toBe('keep\n');
    expect(await read('.embeddings/cache-2.bin')).toBe('cache\n');
    expect(await read(`${BACKUPS_DIR_NAME}/marker.txt`)).toBe('marker\n');
  });
});

describe('type conflicts and empty directories', () => {
  it('replaces a directory with a file and a file with a directory', async () => {
    const { archive } = await prepare();
    await fsp.rm(path.join(DATA, 'tasks/acme/t2.json'));
    await fsp.mkdir(path.join(DATA, 'tasks/acme/t2.json'), { recursive: true });
    await fsp.writeFile(path.join(DATA, 'tasks/acme/t2.json/junk'), 'junk');
    await fsp.rm(path.join(DATA, 'knowledge/acme'), { recursive: true });
    await fsp.writeFile(path.join(DATA, 'knowledge/acme'), 'not a directory');

    await applyRestore(archive);
    expect(await read('tasks/acme/t2.json')).toBe('{"id":"t2","title":"two"}\n');
    expect(await read('knowledge/acme/d1.md')).toBe('---\nid: d1\n---\nbody one\n');
  });

  it('prunes extra files and directories under the archived roots', async () => {
    const { archive } = await prepare();
    await write('knowledge/acme/extra/deep/gone.md', 'gone\n');
    await applyRestore(archive);
    expect(await exists(path.join(DATA, 'knowledge/acme/extra'))).toBe(false);
  });

  it('refuses to write through a symlink planted in DATA_DIR', async () => {
    await seed();
    const archive = await rawArchive('no-dir-entries', [
      { name: 'tasks/acme/t1.json', content: '{"id":"t1","title":"ARCHIVE"}\n' },
    ]);
    const outer = path.join(ROOT, 'outside-dir');
    await fsp.mkdir(outer, { recursive: true });
    await fsp.rm(path.join(DATA, 'tasks'), { recursive: true });
    await fsp.symlink(outer, path.join(DATA, 'tasks'));

    const plan = await restoreArchive({ archive, dataDir: DATA });
    await expect(
      restoreArchive({ archive, dataDir: DATA, dryRun: false, confirm: plan.applyToken }),
    ).rejects.toThrow(/refusing to write through a symlink/);
    expect(await fsp.readdir(outer)).toEqual([]);
  });
});

describe('snapshot failure', () => {
  it('refuses to apply when the pre-restore snapshot cannot be written', async () => {
    await seed();
    const { archivePath } = await createBackupArchive({ dataDir: DATA, out: path.join(ROOT, 'out') });
    await mutate();
    const plan = await restoreArchive({ archive: archivePath, dataDir: DATA });
    await fsp.rm(path.join(DATA, BACKUPS_DIR_NAME), { recursive: true, force: true });
    await fsp.writeFile(path.join(DATA, BACKUPS_DIR_NAME), 'not a directory');

    await expectRestoreCode(
      () => restoreArchive({ archive: archivePath, dataDir: DATA, dryRun: false, confirm: plan.applyToken }),
      'RESTORE_SNAPSHOT_FAILED',
    );
    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"CHANGED"}\n');
  });
});

describe('rollback on mid-apply failure (ADR §11)', () => {
  it('restores the pre-restore snapshot when a write fails halfway', async () => {
    const { archive } = await prepare();
    await mutate();

    const original = fsp.copyFile.bind(fsp);
    vi.spyOn(fsp, 'copyFile').mockImplementation(async (src, dst, mode) => {
      if (String(src).includes('.restore-tmp') && String(src).endsWith('tasks/acme/t1.json')) {
        throw new Error('injected copy failure');
      }
      return original(src, dst, mode);
    });

    const plan = await restoreArchive({ archive, dataDir: DATA });
    const failure = await restoreArchive({
      archive,
      dataDir: DATA,
      dryRun: false,
      confirm: plan.applyToken,
    }).then(
      () => null,
      (e: Error) => e,
    );
    expect(failure?.message).toMatch(/injected copy failure/);
    expect((failure as Error & { rolledBack?: boolean }).rolledBack).toBe(true);

    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"CHANGED"}\n');
    expect(await exists(path.join(DATA, 'knowledge/acme/d2-added-after-backup.md'))).toBe(true);
    expect(await exists(path.join(DATA, 'knowledge/acme/d1.md'))).toBe(false);
    expect(await exists(path.join(DATA, 'newroot'))).toBe(false);
  });
});

describe('rollback cleans files created outside the snapshot', () => {
  it('removes a brand-new root created before the failing write', async () => {
    await seed();
    const archive = await rawArchive('new-root', [
      { name: 'newroot/file.txt', content: 'new\n' },
      { name: 'tasks/acme/t1.json', content: '{"id":"t1","title":"ARCHIVE"}\n' },
    ]);
    const original = fsp.copyFile.bind(fsp);
    vi.spyOn(fsp, 'copyFile').mockImplementation(async (src, dst, mode) => {
      if (String(src).includes('.restore-tmp') && String(src).endsWith('tasks/acme/t1.json')) {
        throw new Error('injected copy failure');
      }
      return original(src, dst, mode);
    });

    const plan = await restoreArchive({ archive, dataDir: DATA });
    const failure = await restoreArchive({
      archive,
      dataDir: DATA,
      dryRun: false,
      confirm: plan.applyToken,
    }).then(
      () => null,
      (e: Error) => e,
    );
    expect(failure?.message).toMatch(/injected copy failure/);
    expect(await exists(path.join(DATA, 'newroot'))).toBe(false);
  });
});

describe('.restore.lock between processes (ADR §8)', () => {
  it('a live foreign lock returns RESTORE_TARGET_BUSY and changes nothing', async () => {
    const { archive } = await prepare();
    await mutate();
    const plan = await restoreArchive({ archive, dataDir: DATA });
    await fsp.writeFile(
      path.join(DATA, RESTORE_LOCK_NAME),
      `${JSON.stringify({ pid: process.pid, startedAt: Date.now(), host: os.hostname(), token: 'foreign' })}\n`,
    );

    await expectRestoreCode(
      () =>
        restoreArchive({
          archive,
          dataDir: DATA,
          dryRun: false,
          confirm: plan.applyToken,
        }),
      'RESTORE_TARGET_BUSY',
    );
    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"CHANGED"}\n');
    expect(await fsp.readFile(path.join(DATA, RESTORE_LOCK_NAME), 'utf8')).toContain('foreign');
  });

  it('a stale lock of a dead process is reclaimed and released after the restore', async () => {
    const { archive } = await prepare();
    await mutate();
    const lockFile = path.join(DATA, RESTORE_LOCK_NAME);
    await fsp.writeFile(
      lockFile,
      `${JSON.stringify({ pid: 999999, startedAt: Date.now(), host: 'gone', token: 'stale' })}\n`,
    );

    const { applied } = await applyRestore(archive);
    expect(applied.applied).toBe(true);
    expect(await exists(lockFile)).toBe(false);
  });
});

describe('runtime lock files are never archived or restored', () => {
  it('admin_backup excludes .server.lock and .restore.lock', async () => {
    await seed();
    await write(SERVER_LOCK_NAME, '{"pid":1}\n');
    await write(RESTORE_LOCK_NAME, '{"pid":2}\n');
    const result = await createBackupArchive({ dataDir: DATA, label: 'locks' });
    const read = await readBackupArchive(result.archivePath);
    expect(read.manifest.excluded).toContain(SERVER_LOCK_NAME);
    expect(read.manifest.excluded).toContain(RESTORE_LOCK_NAME);
    expect(read.entries.map((e) => e.path)).not.toContain(SERVER_LOCK_NAME);
    expect(read.entries.map((e) => e.path)).not.toContain(RESTORE_LOCK_NAME);
  });

  it('restore does not overwrite or delete an existing .server.lock', async () => {
    await seed();
    const archive = await rawArchive('with-server-lock', [
      { name: 'stopwords.txt', content: 'and\n' },
      { name: SERVER_LOCK_NAME, content: '{"pid":999}\n' },
    ]);
    await write(SERVER_LOCK_NAME, '{"pid":1}\n');

    const plan = await restoreArchive({ archive, dataDir: DATA });
    expect(plan.warnings.some((w) => w.includes(SERVER_LOCK_NAME))).toBe(true);
    const applied = await restoreArchive({ archive, dataDir: DATA, dryRun: false, confirm: plan.applyToken });
    expect(applied.applied).toBe(true);
    expect(await read(SERVER_LOCK_NAME)).toBe('{"pid":1}\n');
  });

  it('a legacy snapshot path for .server.lock is skipped', async () => {
    await seed();
    const { createDataBackup } = await import('../src/services/data-backup.js');
    const snapshot = await createDataBackup({
      dataDir: DATA,
      tasksDir: path.join(DATA, 'tasks'),
      knowledgeDir: path.join(DATA, 'knowledge'),
      label: 'legacy-lock',
      scope: 'tasks',
      project: 'acme',
      includeSecrets: true,
    });
    const manifestFile = path.join(snapshot!.backupDir, 'manifest.json');
    const manifest = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
    manifest.paths.push({ from: path.join(DATA, SERVER_LOCK_NAME), to: SERVER_LOCK_NAME });
    await fsp.copyFile(path.join(DATA, 'stopwords.txt'), path.join(snapshot!.backupDir, SERVER_LOCK_NAME));
    await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    await write(SERVER_LOCK_NAME, '{"pid":1}\n');

    const result = await restoreBackup(snapshot!.backupDir, { dataDir: DATA, includeSecrets: true });
    expect(result.warnings.some((w) => w.includes(SERVER_LOCK_NAME))).toBe(true);
    expect(await read(SERVER_LOCK_NAME)).toBe('{"pid":1}\n');
  });
});

describe('admin_restore tool', () => {
  it('registers, dry-runs with an applyToken and enforces the admin role', async () => {
    await seed();
    const backend = await createBackupArchive({ dataDir: DATA, label: 'tool' });
    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = DATA;
    vi.resetModules();
    try {
      const mod = await import('../src/register/backup.js');
      type ToolResult = { content: Array<{ text: string }> };
      type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>;
      const registered: Array<{ name: string; handler: ToolHandler }> = [];
      const ctx = {
        server: {
          registerTool: (name: string, _cfg: unknown, handler: ToolHandler) => {
            registered.push({ name, handler });
            return { name };
          },
        },
        authManager: undefined as unknown,
        sessionManager: undefined as unknown,
      };
      mod.registerBackupTools(ctx as unknown as Parameters<typeof mod.registerBackupTools>[0]);
      const handler = registered.find((r) => r.name === 'admin_restore')!.handler;

      const okRes = JSON.parse((await handler({ archive: backend.archivePath })).content[0].text);
      expect(okRes.ok).toBe(true);
      expect(okRes.data.dryRun).toBe(true);
      expect(okRes.data.applyToken).toBeTruthy();

      ctx.authManager = { isAuthRequired: () => true };
      ctx.sessionManager = { get: () => ({ metadata: { roles: ['user'] } }) };
      const denied = JSON.parse(
        (await handler({ archive: backend.archivePath }, { sessionId: 's1' })).content[0].text,
      );
      expect(denied.ok).toBe(false);
      expect(denied.error.message).toContain('admin');
    } finally {
      process.env.DATA_DIR = prev;
      vi.resetModules();
    }
  });
});

describe('acquireRestoreLock', () => {
  it('releases only its own lock', async () => {
    const first = await acquireRestoreLock(DATA);
    await expect(acquireRestoreLock(DATA)).rejects.toBeInstanceOf(RestoreError);
    const lockFile = path.join(DATA, RESTORE_LOCK_NAME);
    const holder = JSON.parse(await fsp.readFile(lockFile, 'utf8'));
    await fsp.writeFile(lockFile, JSON.stringify({ ...holder, token: 'replaced' }));
    await first.release();
    expect(await exists(lockFile)).toBe(true);
    await fsp.writeFile(lockFile, JSON.stringify(holder));
    await first.release();
    const second = await acquireRestoreLock(DATA);
    await second.release();
    expect(await exists(path.join(DATA, RESTORE_LOCK_NAME))).toBe(false);
  });
});
