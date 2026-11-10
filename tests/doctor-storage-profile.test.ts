import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import { createSqliteProfile } from '../src/storage/profiles/sqlite/index.js';
import { inspectActiveStorageProfile } from '../src/cli/storage-profile-inspect.js';

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Y-gate §5.6: doctor storage-profile inspection', () => {
  it('reports the file profile with its real manifest', async () => {
    const summary = await inspectActiveStorageProfile(DATA_DIR, { STORAGE_PROFILE: 'file' });
    expect(summary.profile).toBe('file');
    expect(summary.error).toBeUndefined();
    expect(summary.collections).toContain('tasks');
    expect(summary.collections).toContain('docs');
    expect(summary.capabilities).toHaveProperty('transactions');
  });

  it('reports the sqlite profile only when its database exists', async () => {
    const missing = await inspectActiveStorageProfile(DATA_DIR, { STORAGE_PROFILE: 'sqlite' });
    expect(missing.profile).toBe('sqlite');
    expect(missing.error).toMatch(/not found/);

    const dir = fs.mkdtempSync(path.join(DATA_DIR, '.tmp-doctor-profile-'));
    tempDirs.push(dir);
    const databasePath = path.join(dir, '.index', 'storage.sqlite');
    const profile = createSqliteProfile({ databasePath });
    profile.close?.();
    // The inspector reads the conventional DATA_DIR path, so exercise the real location too.
    const summary = await inspectActiveStorageProfile(dir, { STORAGE_PROFILE: 'sqlite' });
    expect(summary.profile).toBe('sqlite');
    expect(summary.error).toBeUndefined();
    expect(summary.collections).toContain('tasks');
    expect(summary.collections).toContain('history');
  });

  it('does not pretend postgres is available without a URL', async () => {
    const summary = await inspectActiveStorageProfile(DATA_DIR, { STORAGE_PROFILE: 'postgres' });
    expect(summary.profile).toBe('postgres');
    expect(summary.error).toMatch(/POSTGRES_URL/);
  });

  it('reports unknown profiles honestly', async () => {
    const summary = await inspectActiveStorageProfile(DATA_DIR, { STORAGE_PROFILE: 'weird' });
    expect(summary.profile).toBe('weird');
    expect(summary.error).toMatch(/unknown STORAGE_PROFILE/);
  });
});
