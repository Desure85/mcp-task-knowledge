/**
 * DX-16a — portable DATA_DIR archive (ADR-008).
 *
 * Covers the writer/reader contract and the hostile-input surface. Archives
 * produced by the writer are additionally verified with GNU tar and sha256 so
 * the format is not just self-consistent (writer ↔ reader), but readable by
 * standard tools.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {
  createBackupArchive,
  readBackupArchive,
  BackupArchiveError,
} from '../src/services/backup-archive.js';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let ROOT: string;
let DATA: string;

async function write(rel: string, content: string | Buffer): Promise<void> {
  const abs = path.join(DATA, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(abs, base)));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Realistic DATA_DIR with data, caches, secrets, a symlink and a long path. */
async function seed(): Promise<void> {
  await write('tasks/acme/t1.json', '{"id":"t1"}\n');
  await write('tasks/acme/t2.json', '{"id":"t2"}\n');
  await write('knowledge/acme/d1.md', '---\nid: d1\n---\nbody\n');
  await write('projects/acme.json', '{"id":"acme"}\n');
  await write('memory/layers.json', '{"layers":[]}\n');
  await write('prompts/p1.json', '{"id":"p1"}\n');
  await write('stopwords.txt', 'and\n');
  await write('.state.json', '{"current":"acme"}\n');
  await write('.schema-version', '{"schema":1,"updatedAt":"x","updatedBy":"y"}\n');
  await write('.jwt-revoked.json', '{"revoked":["j1"]}\n');
  await write('auth.db', 'sqlite-bytes');
  await write('audit.log', 'audit-line\n');
  await write('.embeddings/cache.bin', 'cache\n');
  await write('.backups/old/manifest.json', '{"old":true}\n');
  await write('models/gemma/model.onnx', 'onnx-bytes');
  const longSeg = 'a'.repeat(120);
  await write(`knowledge/deep/${longSeg}.md`, 'long\n');
  await fs.symlink('/etc/hostname', path.join(DATA, 'outside-link'));
}

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<BackupArchiveError> {
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

function systemTar(args: string[], cwd: string): void {
  execFileSync('tar', args, { cwd, stdio: 'pipe' });
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** Raw ustar header — used for fixtures that standard tar cannot produce. */
function rawHeader(name: string, size: number): Buffer {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(0o644, 8), 100, 'ascii');
  buf.write(octal(0, 8), 108, 'ascii');
  buf.write(octal(0, 8), 116, 'ascii');
  buf.write(octal(size, 12), 124, 'ascii');
  buf.write(octal(0, 12), 136, 'ascii');
  buf.fill(0x20, 148, 156);
  buf.write('0', 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

function manifestJson(overrides: Record<string, unknown>, entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({
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
    entries,
    stats: { files: entries.filter((e) => e.type === 'file').length, bytes: 0, dirs: 0 },
    ...overrides,
  });
}

/** Build an archive with system tar: `files` maps relative path -> content. */
async function systemArchive(
  name: string,
  files: Record<string, string>,
  tarArgs: (tree: string, out: string) => string[] = (tree, out) => ['-czf', out, '-C', tree, ...Object.keys(files)],
): Promise<string> {
  const tree = path.join(ROOT, `tree-${name}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tree, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  const out = path.join(ROOT, `${name}.tgz`);
  systemTar(tarArgs(tree, out), ROOT);
  return out;
}

beforeEach(async () => {
  ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'dx16a-archive-'));
  DATA = path.join(ROOT, 'data');
  await fs.mkdir(DATA, { recursive: true });
  delete process.env.BACKUP_MAX_MB;
});

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
  delete process.env.BACKUP_MAX_MB;
});

describe('createBackupArchive', () => {
  it('roundtrip: reader extracts exactly the archived bytes and sha256 matches', async () => {
    await seed();
    const result = await createBackupArchive({ dataDir: DATA, label: 'roundtrip' });

    const extractDir = path.join(ROOT, 'extract');
    const read = await readBackupArchive(result.archivePath, { extractTo: extractDir });

    expect(result.files).toBe(read.manifest.stats.files);
    expect(read.entries.length).toBe(read.manifest.entries.length);

    // Every archived file matches the source byte-for-byte.
    for (const entry of read.manifest.entries.filter((e) => e.type === 'file')) {
      const src = await fs.readFile(path.join(DATA, entry.path));
      const dst = await fs.readFile(path.join(extractDir, entry.path));
      expect(dst.equals(src)).toBe(true);
      expect(createHash('sha256').update(dst).digest('hex')).toBe(entry.sha256);
      expect(dst.length).toBe(entry.size);
    }

    // Empty directories survive too.
    expect(read.manifest.entries.some((e) => e.type === 'dir' && e.path === 'knowledge/acme')).toBe(true);
  });

  it('corrupt: garbage and truncated gzip are rejected as BACKUP_ARCHIVE_INVALID', async () => {
    await seed();
    const good = await createBackupArchive({ dataDir: DATA });

    const garbage = path.join(ROOT, 'garbage.tgz');
    await fs.writeFile(garbage, Buffer.from('this is not a gzip stream'));
    await expectCode(() => readBackupArchive(garbage, { extractTo: path.join(ROOT, 'x1') }), 'BACKUP_ARCHIVE_INVALID');
    expect(await exists(path.join(ROOT, 'x1'))).toBe(false);

    const bytes = await fs.readFile(good.archivePath);
    const truncated = path.join(ROOT, 'truncated.tgz');
    await fs.writeFile(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await expectCode(() => readBackupArchive(truncated, { extractTo: path.join(ROOT, 'x2') }), 'BACKUP_ARCHIVE_INVALID');
  });

  it('traversal: a ../ entry produced by system tar is refused and nothing is written outside', async () => {
    const evil = await systemArchive('traversal', { 'knowledge/acme/d1.md': 'body\n' }, (tree, out) => [
      '-czf',
      out,
      '-C',
      tree,
      '--transform=s|^knowledge|../knowledge|',
      'knowledge',
    ]);
    const target = path.join(ROOT, 'escape-target');
    await expectCode(() => readBackupArchive(evil, { extractTo: target }), 'BACKUP_PATH_ESCAPE');
    expect(await exists(path.join(ROOT, 'knowledge'))).toBe(false);
    expect(await listFiles(target)).toEqual([]);
  });

  it('absolute: an absolute path produced by system tar -P is refused', async () => {
    const tree = path.join(ROOT, 'tree-abs');
    await fs.mkdir(path.join(tree, 'knowledge'), { recursive: true });
    const file = path.join(tree, 'knowledge', 'd1.md');
    await fs.writeFile(file, 'body\n');
    const out = path.join(ROOT, 'absolute.tgz');
    systemTar(['-czf', out, '-P', file], ROOT);
    await expectCode(() => readBackupArchive(out), 'BACKUP_PATH_ESCAPE');
  });

  it('symlink: a symlink entry produced by system tar is refused and not created', async () => {
    const tree = path.join(ROOT, 'tree-symlink');
    await fs.mkdir(tree, { recursive: true });
    await fs.symlink('/etc/hostname', path.join(tree, 'outside-link'));
    const out = path.join(ROOT, 'symlink.tgz');
    systemTar(['-czf', out, '-C', tree, 'outside-link'], ROOT);

    const target = path.join(ROOT, 'symlink-target');
    await expectCode(() => readBackupArchive(out, { extractTo: target }), 'BACKUP_SYMLINK_REJECTED');
    expect(await exists(path.join(target, 'outside-link'))).toBe(false);
  });

  it('bomb: a header declaring more bytes than the limit is refused before writing', async () => {
    const bomb = path.join(ROOT, 'bomb.tgz');
    const declared = 10 * 1024 * 1024 * 1024;
    await fs.writeFile(bomb, gzipSync(Buffer.concat([rawHeader('big.bin', declared), Buffer.alloc(1024)])));
    await expectCode(() => readBackupArchive(bomb, { extractTo: path.join(ROOT, 'bomb-out') }), 'BACKUP_TOO_LARGE');
    expect(await exists(path.join(ROOT, 'bomb-out'))).toBe(false);
  });

  it('secrets: .jwt-revoked.json and auth.db stay out unless includeSecrets is set', async () => {
    await seed();
    const plain = await createBackupArchive({ dataDir: DATA, label: 'plain' });
    const plainRead = await readBackupArchive(plain.archivePath);
    const plainPaths = plainRead.manifest.entries.map((e) => e.path);
    expect(plainPaths).not.toContain('.jwt-revoked.json');
    expect(plainPaths).not.toContain('auth.db');
    expect(plainPaths).not.toContain('audit.log');
    expect(plainPaths).not.toContain('.embeddings/cache.bin');
    expect(plainPaths).not.toContain('.backups/old/manifest.json');
    expect(plain.manifest.containsSecrets).toBe(false);
    expect(plainRead.manifest.excluded).toEqual(
      expect.arrayContaining(['.backups', '.embeddings', '.emb_cache', '.jwt-revoked.json', 'auth.db', 'audit.log']),
    );

    const withSecrets = await createBackupArchive({ dataDir: DATA, label: 'secrets', includeSecrets: true });
    const secretRead = await readBackupArchive(withSecrets.archivePath);
    const secretPaths = secretRead.manifest.entries.map((e) => e.path);
    expect(secretPaths).toContain('.jwt-revoked.json');
    expect(secretPaths).toContain('auth.db');
    expect(secretRead.manifest.containsSecrets).toBe(true);
  });

  it('models: excluded only with excludeModels', async () => {
    await seed();
    const withModels = await readBackupArchive((await createBackupArchive({ dataDir: DATA, label: 'models-in' })).archivePath);
    expect(withModels.manifest.entries.some((e) => e.path.startsWith('models/'))).toBe(true);

    const without = await readBackupArchive(
      (await createBackupArchive({ dataDir: DATA, label: 'models-out', excludeModels: true })).archivePath,
    );
    expect(without.manifest.entries.some((e) => e.path.startsWith('models/'))).toBe(false);
    expect(without.manifest.excluded).toContain('models');
  });

  it('profile: sqlite/postgres are refused with BACKUP_PROFILE_UNSUPPORTED', async () => {
    await seed();
    await expectCode(() => createBackupArchive({ dataDir: DATA, profile: 'sqlite' }), 'BACKUP_PROFILE_UNSUPPORTED');
    await expectCode(() => createBackupArchive({ dataDir: DATA, profile: 'postgres' }), 'BACKUP_PROFILE_UNSUPPORTED');
  });

  it.skipIf(isRoot)('partial: a failed run leaves neither .partial nor .tar.gz', async () => {
    await seed();
    const victim = path.join(DATA, 'tasks', 'acme', 't1.json');
    await fs.chmod(victim, 0o000);
    try {
      await expectCode(() => createBackupArchive({ dataDir: DATA, label: 'fail' }), 'BACKUP_ARCHIVE_INVALID');
    } finally {
      await fs.chmod(victim, 0o644);
    }
    const leftovers = await fs.readdir(path.join(DATA, '.backups'));
    expect(leftovers.filter((f) => f.endsWith('.partial'))).toEqual([]);
    expect(leftovers.filter((f) => f.endsWith('.tar.gz'))).toEqual([]);
  });

  it('live: concurrent writes do not corrupt the archive (checksums still match)', async () => {
    await seed();
    await write('tasks/live/state.json', '0');

    let stop = false;
    const writer = (async () => {
      for (let i = 1; i <= 200 && !stop; i++) {
        await fs.writeFile(path.join(DATA, 'tasks', 'live', 'state.json'), `${i}`.repeat(200));
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    const result = await createBackupArchive({ dataDir: DATA, label: 'live' });
    stop = true;
    await writer;

    const read = await readBackupArchive(result.archivePath, { extractTo: path.join(ROOT, 'live-extract') });
    const liveEntry = read.manifest.entries.find((e) => e.path === 'tasks/live/state.json');
    expect(liveEntry).toBeDefined();
    const extracted = await fs.readFile(path.join(ROOT, 'live-extract', 'tasks', 'live', 'state.json'));
    expect(extracted.length).toBe(liveEntry!.size);
    expect(createHash('sha256').update(extracted).digest('hex')).toBe(liveEntry!.sha256);
  });

  it('readonly: the backup does not mutate DATA_DIR or create .schema-version', async () => {
    await seed();
    await fs.rm(path.join(DATA, '.schema-version'), { force: true });
    const before = (await listFiles(DATA)).filter((p) => !p.startsWith('.backups/'));

    await createBackupArchive({ dataDir: DATA, label: 'readonly' });

    const after = (await listFiles(DATA)).filter((p) => !p.startsWith('.backups/'));
    expect(after).toEqual(before);
    expect(await exists(path.join(DATA, '.schema-version'))).toBe(false);
  });

  it('self-inclusion: the default output inside .backups is never packed into itself', async () => {
    await seed();
    const first = await createBackupArchive({ dataDir: DATA, label: 'first' });
    const second = await createBackupArchive({ dataDir: DATA, label: 'second' });
    expect(second.archivePath).not.toBe(first.archivePath);

    const read = await readBackupArchive(second.archivePath);
    expect(read.manifest.entries.some((e) => e.path.includes('.backups'))).toBe(false);
    expect(read.manifest.entries.some((e) => e.path.endsWith('.tar.gz'))).toBe(false);
  });

  it('long path: a 120-char segment survives a PAX round-trip and is visible to system tar', async () => {
    await seed();
    const result = await createBackupArchive({ dataDir: DATA, label: 'long' });
    const longPath = `knowledge/deep/${'a'.repeat(120)}.md`;

    const listing = execFileSync('tar', ['-tzf', result.archivePath], { encoding: 'utf8' });
    expect(listing).toContain(longPath);

    const read = await readBackupArchive(result.archivePath, { extractTo: path.join(ROOT, 'long-extract') });
    expect(read.manifest.entries.some((e) => e.path === longPath)).toBe(true);
    expect(await fs.readFile(path.join(ROOT, 'long-extract', longPath), 'utf8')).toBe('long\n');
  });

  it('deterministic: the same clock and input produce byte-identical archives', async () => {
    await seed();
    const now = new Date('2026-11-06T18:39:33.782Z');
    const a = await createBackupArchive({ dataDir: DATA, out: path.join(ROOT, 'det-a'), now });
    const b = await createBackupArchive({ dataDir: DATA, out: path.join(ROOT, 'det-b'), now });
    expect(a.bytes).toBe(b.bytes);
    const [ba, bb] = await Promise.all([fs.readFile(a.archivePath), fs.readFile(b.archivePath)]);
    expect(ba.equals(bb)).toBe(true);
  });

  it('formatVersion: a newer container version is refused', async () => {
    const archive = await systemArchive('v2', {
      'manifest.json': manifestJson({ formatVersion: 2 }, []),
      'x.txt': 'x',
    });
    await expectCode(() => readBackupArchive(archive), 'BACKUP_FORMAT_VERSION_UNSUPPORTED');
  });

  it('schema: an archive from a newer schema is refused', async () => {
    const content = 'hello';
    const sha = createHash('sha256').update(content).digest('hex');
    const archive = await systemArchive('schema', {
      'manifest.json': manifestJson({ schemaVersion: 99 }, [
        { path: 'x.txt', type: 'file', size: content.length, sha256: sha },
      ]),
      'x.txt': content,
    });
    await expectCode(() => readBackupArchive(archive), 'BACKUP_SCHEMA_TOO_NEW');
  });

  it('checksum: a manifest sha256 that does not match the content is refused', async () => {
    const archive = await systemArchive('checksum', {
      'manifest.json': manifestJson({}, [
        { path: 'x.txt', type: 'file', size: 5, sha256: '0'.repeat(64) },
      ]),
      'x.txt': 'hello',
    });
    await expectCode(() => readBackupArchive(archive), 'BACKUP_CHECKSUM_MISMATCH');
  });

  it('not found: a missing archive is BACKUP_NOT_FOUND', async () => {
    await expectCode(() => readBackupArchive(path.join(ROOT, 'nope.tar.gz')), 'BACKUP_NOT_FOUND');
  });

  it('empty DATA_DIR: a manifest-only archive round-trips', async () => {
    const result = await createBackupArchive({ dataDir: DATA, label: 'empty' });
    const read = await readBackupArchive(result.archivePath, { extractTo: path.join(ROOT, 'empty-extract') });
    expect(read.entries).toEqual([]);
    expect(read.manifest.stats.files).toBe(0);
    expect(read.manifest.profile).toBe('files');
    expect(read.manifest.schemaVersion).toBe(0);
  });
});

describe('admin_backup tool', () => {
  it('registers, archives DATA_DIR and enforces the admin role on authenticated transports', async () => {
    const prev = process.env.DATA_DIR;
    const toolData = path.join(ROOT, 'tool-data');
    await fs.mkdir(toolData, { recursive: true });
    await fs.writeFile(path.join(toolData, 'stopwords.txt'), 'and\n');
    process.env.DATA_DIR = toolData;
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
      expect(registered.map((r) => r.name)).toContain('admin_backup');

      const handler = registered.find((r) => r.name === 'admin_backup')!.handler;
      const okRes = await handler({ label: 'tool' });
      const okEnv = JSON.parse(okRes.content[0].text);
      expect(okEnv.ok).toBe(true);
      expect(okEnv.data.archivePath).toContain('.backups');
      expect(okEnv.data.bytes).toBeGreaterThan(0);
      expect(okEnv.data.manifest.profile).toBe('files');

      ctx.authManager = { isAuthRequired: () => true };
      ctx.sessionManager = { get: () => ({ metadata: { roles: ['user'] } }) };
      const denied = JSON.parse((await handler({}, { sessionId: 's1' })).content[0].text);
      expect(denied.ok).toBe(false);
      expect(denied.error.message).toContain('admin');

      ctx.sessionManager = { get: () => ({ metadata: { roles: ['admin'] } }) };
      const allowed = JSON.parse((await handler({ label: 'tool-admin' }, { sessionId: 's1' })).content[0].text);
      expect(allowed.ok).toBe(true);
    } finally {
      process.env.DATA_DIR = prev;
      vi.resetModules();
    }
  });
});
