/**
 * DX-19 — pre-destructive-operation backups of DATA_DIR.
 *
 * Tests the service directly against a fixture DATA_DIR in a tmp dir —
 * no server context needed (paths injected, DX-17 pattern).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import {
  createDataBackup,
  listBackups,
  restoreBackup,
  isBackupRequired,
  BACKUPS_DIR_NAME,
  BACKUP_MANIFEST_FILE,
  type BackupPaths,
} from '../src/services/data-backup.js';

let ROOT: string;
let PATHS: BackupPaths;

async function write(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf-8');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function seedProject(project: string) {
  await write(path.join(PATHS.tasksDir, project, 't1.json'), JSON.stringify({ id: 't1', project }));
  await write(path.join(PATHS.tasksDir, project, 't2.json'), JSON.stringify({ id: 't2', project }));
  await write(path.join(PATHS.knowledgeDir, project, 'd1.md'), `---\nid: d1\nproject: ${project}\n---\nbody`);
  await write(path.join(ROOT, 'projects', `${project}.json`), JSON.stringify({ id: project }));
}

beforeEach(async () => {
  ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  PATHS = {
    dataDir: ROOT,
    tasksDir: path.join(ROOT, 'tasks'),
    knowledgeDir: path.join(ROOT, 'knowledge'),
  };
  delete process.env.BACKUP_MAX_MB;
  delete process.env.BACKUP_KEEP;
  delete process.env.BACKUP_REQUIRED;
});

afterEach(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  delete process.env.BACKUP_MAX_MB;
  delete process.env.BACKUP_KEEP;
  delete process.env.BACKUP_REQUIRED;
});

describe('createDataBackup', () => {
  it('creates a backup dir with manifest for scope=project', async () => {
    await seedProject('acme');
    const r = await createDataBackup({ ...PATHS, label: 'pre-purge', scope: 'project', project: 'acme', tool: 'project_purge' });
    expect(r).toBeDefined();
    expect(path.basename(r!.backupDir)).toMatch(/-pre-purge$/);

    const manifest = JSON.parse(await fsp.readFile(path.join(r!.backupDir, BACKUP_MANIFEST_FILE), 'utf-8'));
    expect(manifest.scope).toBe('project');
    expect(manifest.project).toBe('acme');
    expect(manifest.tool).toBe('project_purge');
    expect(manifest.filesCount).toBe(4); // 2 tasks + 1 doc + 1 project meta
    expect(manifest.bytes).toBeGreaterThan(0);
    expect(typeof manifest.createdAt).toBe('string');

    // Content actually copied
    expect(await exists(path.join(r!.backupDir, 'tasks', 'acme', 't1.json'))).toBe(true);
    expect(await exists(path.join(r!.backupDir, 'knowledge', 'acme', 'd1.md'))).toBe(true);
    expect(await exists(path.join(r!.backupDir, 'projects', 'acme.json'))).toBe(true);
  });

  it('scope=tasks copies only the tasks subtree', async () => {
    await seedProject('acme');
    const r = await createDataBackup({ ...PATHS, label: 'pre-bulk-delete', scope: 'tasks', project: 'acme' });
    expect(r).toBeDefined();
    expect(await exists(path.join(r!.backupDir, 'tasks', 'acme', 't1.json'))).toBe(true);
    expect(await exists(path.join(r!.backupDir, 'knowledge'))).toBe(false);
    expect(r!.manifest.filesCount).toBe(2);
  });

  it('scope=knowledge copies only the knowledge subtree', async () => {
    await seedProject('acme');
    const r = await createDataBackup({ ...PATHS, label: 'pre-bulk-delete', scope: 'knowledge', project: 'acme' });
    expect(await exists(path.join(r!.backupDir, 'knowledge', 'acme', 'd1.md'))).toBe(true);
    expect(await exists(path.join(r!.backupDir, 'tasks'))).toBe(false);
    expect(r!.manifest.filesCount).toBe(1);
  });

  it('scope=full copies DATA_DIR minus .backups and caches', async () => {
    await seedProject('acme');
    await write(path.join(ROOT, '.state.json'), '{}');
    await write(path.join(ROOT, '.embeddings', 'vec.bin'), 'x');
    // an existing backup must not be recursively copied
    await write(path.join(ROOT, BACKUPS_DIR_NAME, '2020-01-01-old', 'dummy.txt'), 'old');

    const r = await createDataBackup({ ...PATHS, label: 'full-snap', scope: 'full' });
    expect(r).toBeDefined();
    expect(await exists(path.join(r!.backupDir, 'tasks', 'acme', 't1.json'))).toBe(true);
    expect(await exists(path.join(r!.backupDir, '.state.json'))).toBe(true);
    expect(await exists(path.join(r!.backupDir, BACKUPS_DIR_NAME))).toBe(false);
    expect(await exists(path.join(r!.backupDir, '.embeddings'))).toBe(false);
  });

  it('returns undefined for an empty scope (no empty backup dirs)', async () => {
    const r = await createDataBackup({ ...PATHS, label: 'pre-purge', scope: 'project', project: 'ghost' });
    expect(r).toBeUndefined();
    expect(await exists(path.join(ROOT, BACKUPS_DIR_NAME))).toBe(false);
  });

  it('rotates old backups beyond BACKUP_KEEP', async () => {
    await seedProject('acme');
    const backupsRoot = path.join(ROOT, BACKUPS_DIR_NAME);
    // Pre-create 3 old backups with sortable names
    for (const name of ['2020-01-01-a', '2020-01-02-b', '2020-01-03-c']) {
      await write(path.join(backupsRoot, name, 'x.txt'), 'x');
    }
    await createDataBackup({ ...PATHS, label: 'new', scope: 'tasks', project: 'acme', keep: 2 });
    const remaining = await fsp.readdir(backupsRoot);
    expect(remaining.sort()).toHaveLength(2);
    expect(remaining).not.toContain('2020-01-01-a');
    expect(remaining).not.toContain('2020-01-02-b');
  });

  it('flags oversized backups but still proceeds', async () => {
    await seedProject('acme');
    const r = await createDataBackup({
      ...PATHS,
      label: 'big',
      scope: 'project',
      project: 'acme',
      maxBytes: 1, // 1 byte — everything is oversized
    });
    expect(r).toBeDefined();
    expect(r!.manifest.oversized).toBe(true);
    expect(await exists(path.join(r!.backupDir, 'tasks', 'acme', 't1.json'))).toBe(true);
  });

  it('sanitizes label for the dir name', async () => {
    await seedProject('acme');
    const r = await createDataBackup({ ...PATHS, label: 'pre purge / weird!', scope: 'tasks', project: 'acme' });
    expect(path.basename(r!.backupDir)).toMatch(/-pre-purge-weird$/);
  });
});

describe('listBackups', () => {
  it('returns newest first with manifests', async () => {
    await seedProject('acme');
    await createDataBackup({ ...PATHS, label: 'one', scope: 'tasks', project: 'acme' });
    // ensure a different timestamp
    await new Promise((r) => setTimeout(r, 5));
    await createDataBackup({ ...PATHS, label: 'two', scope: 'tasks', project: 'acme' });

    const list = await listBackups(ROOT);
    expect(list).toHaveLength(2);
    expect(list[0].manifest?.label).toBe('two');
    expect(list[1].manifest?.label).toBe('one');
  });

  it('returns empty array when no backups exist', async () => {
    expect(await listBackups(ROOT)).toEqual([]);
  });
});

describe('restoreBackup', () => {
  it('dryRun reports paths without writing', async () => {
    await seedProject('acme');
    const r = await createDataBackup({ ...PATHS, label: 'pre-purge', scope: 'project', project: 'acme' });

    // Delete the originals
    await fsp.rm(path.join(PATHS.tasksDir, 'acme'), { recursive: true });

    const dry = await restoreBackup(r!.backupDir, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.restored.length).toBeGreaterThan(0);
    // Nothing actually restored
    expect(await exists(path.join(PATHS.tasksDir, 'acme', 't1.json'))).toBe(false);
  });

  it('real restore copies files back to original locations', async () => {
    await seedProject('acme');
    const r = await createDataBackup({ ...PATHS, label: 'pre-purge', scope: 'project', project: 'acme' });

    // Simulate the destructive op
    await fsp.rm(path.join(PATHS.tasksDir, 'acme'), { recursive: true });
    await fsp.rm(path.join(PATHS.knowledgeDir, 'acme'), { recursive: true });
    await fsp.rm(path.join(ROOT, 'projects', 'acme.json'));

    const res = await restoreBackup(r!.backupDir);
    expect(res.dryRun).toBe(false);
    expect(res.filesCount).toBe(4);

    expect(await exists(path.join(PATHS.tasksDir, 'acme', 't1.json'))).toBe(true);
    expect(await exists(path.join(PATHS.knowledgeDir, 'acme', 'd1.md'))).toBe(true);
    expect(await exists(path.join(ROOT, 'projects', 'acme.json'))).toBe(true);

    const restored = JSON.parse(await fsp.readFile(path.join(PATHS.tasksDir, 'acme', 't1.json'), 'utf-8'));
    expect(restored.id).toBe('t1');
  });

  it('throws on missing manifest', async () => {
    const bogus = path.join(ROOT, BACKUPS_DIR_NAME, 'no-manifest');
    await fsp.mkdir(bogus, { recursive: true });
    await expect(restoreBackup(bogus)).rejects.toThrow(/manifest/);
  });
});

describe('isBackupRequired', () => {
  it('is false by default and true on 1/true/yes', () => {
    expect(isBackupRequired()).toBe(false);
    process.env.BACKUP_REQUIRED = '1';
    expect(isBackupRequired()).toBe(true);
    process.env.BACKUP_REQUIRED = 'true';
    expect(isBackupRequired()).toBe(true);
    process.env.BACKUP_REQUIRED = '0';
    expect(isBackupRequired()).toBe(false);
  });
});
