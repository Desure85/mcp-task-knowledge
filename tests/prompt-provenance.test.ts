import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  hashPackageFiles,
  PromptProvenanceStore,
  ProvenanceError,
  type PackageFile,
  type PackageSource,
} from '../src/prompts/provenance.js';

let tmp = '';
let store: PromptProvenanceStore;

const source: PackageSource = {
  kind: 'github',
  id: 'owner/repo@abc123',
  url: 'https://github.com/owner/repo/tree/abc123',
  version: '1.0.0',
  commit: 'abc123',
  license: 'MIT',
  retrievedAt: '2026-11-11T12:00:00.000Z',
};

const v1: PackageFile[] = [
  { path: 'SKILL.md', content: '# Skill v1\n' },
  { path: 'prompts/review.md', content: 'Review v1\n' },
];

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-provenance-'));
  store = new PromptProvenanceStore(tmp);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('Z-06 PromptProvenanceStore', () => {
  it('imports files with source metadata, a content hash and a snapshot', async () => {
    const manifest = await store.import('demo', v1, source);
    expect(manifest).toMatchObject({ id: 'demo', source, importedAt: source.retrievedAt, history: [] });
    expect(manifest.contentHash).toBe(hashPackageFiles(v1));
    expect(manifest.snapshotId).toMatch(/^snapshot-/);
    expect((await store.status('demo')).modified).toBe(false);
    expect(await store.currentFiles('demo')).toEqual(v1.slice().sort((a, b) => a.path.localeCompare(b.path)));
    const snap = await fs.readFile(path.join(tmp, 'demo', 'snapshots', manifest.snapshotId, 'files', 'SKILL.md'), 'utf8');
    expect(snap).toBe('# Skill v1\n');
  });

  it('marks local edits and refuses to overwrite an edited package without force', async () => {
    await store.import('demo', v1, source);
    await fs.writeFile(path.join(tmp, 'demo', 'files', 'SKILL.md'), '# Local edit\n');
    const status = await store.status('demo');
    expect(status.modified).toBe(true);
    expect(status.contentHash).not.toBe(status.importedHash);

    const next: PackageFile[] = [{ path: 'SKILL.md', content: '# Upstream v2\n' }];
    await expect(store.update('demo', next, { ...source, version: '2.0.0' })).rejects.toMatchObject({ code: 'MODIFIED' });
    expect(await fs.readFile(path.join(tmp, 'demo', 'files', 'SKILL.md'), 'utf8')).toBe('# Local edit\n');

    const forced = await store.update('demo', next, { ...source, version: '2.0.0' }, { force: true });
    expect(forced.updated).toBe(true);
    expect(forced.manifest.source.version).toBe('2.0.0');
    expect(forced.manifest.history).toHaveLength(1);
  });

  it('diffs clean updates, keeps a previous snapshot and rolls back', async () => {
    const first = await store.import('demo', v1, source);
    const next: PackageFile[] = [
      { path: 'SKILL.md', content: '# Skill v2\n' },
      { path: 'prompts/extra.md', content: 'Extra\n' },
    ];
    const diff = await store.diff('demo', next);
    expect(diff).toEqual([
      { path: 'SKILL.md', status: 'changed' },
      { path: 'prompts/extra.md', status: 'added' },
      { path: 'prompts/review.md', status: 'removed' },
    ]);

    const result = await store.update('demo', next, { ...source, version: '2.0.0' });
    expect(result.updated).toBe(true);
    expect(result.diff).toEqual(diff);
    expect(result.manifest.contentHash).toBe(hashPackageFiles(next));
    expect(result.manifest.source.version).toBe('2.0.0');
    expect(result.manifest.history).toHaveLength(1);

    const restored = await store.rollback('demo', first.snapshotId);
    expect(await store.currentFiles('demo')).toEqual(v1.slice().sort((a, b) => a.path.localeCompare(b.path)));
    expect(restored.contentHash).toBe(first.contentHash);
    expect(restored.history).toHaveLength(2);

    const unchanged = await store.update('demo', v1, source);
    expect(unchanged.updated).toBe(false);
    expect(unchanged.diff).toEqual([]);
  });

  it('rejects traversal, duplicate paths and invalid ids', async () => {
    await expect(store.import('../bad', v1, source)).rejects.toMatchObject({ code: 'INVALID_ID' });
    await expect(store.import('demo', [{ path: '../evil.md', content: 'x' }], source)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(store.import('demo', [{ path: '/abs.md', content: 'x' }], source)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(store.import('demo', [
      { path: 'a.md', content: 'a' },
      { path: 'a.md', content: 'b' },
    ], source)).rejects.toBeInstanceOf(ProvenanceError);
  });

  it('refuses a second import unless overwrite is explicit and keeps history', async () => {
    await store.import('demo', v1, source);
    await expect(store.import('demo', v1, source)).rejects.toMatchObject({ code: 'EXISTS' });
    const replaced = await store.import('demo', [{ path: 'SKILL.md', content: '# v3\n' }], { ...source, version: '3.0.0' }, { overwrite: true });
    expect(replaced.source.version).toBe('3.0.0');
    expect(replaced.history).toHaveLength(1);
    expect(replaced.history[0].version).toBe('1.0.0');
  });
});
