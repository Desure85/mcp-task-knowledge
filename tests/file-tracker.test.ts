import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTrackerAdapter } from '../src/sync/file-tracker.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('INT-008 file tracker adapter', () => {
  it('persists issues and assigns ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-file-'));
    dirs.push(dir);
    const file = join(dir, 'tracker.json');
    const adapter = new FileTrackerAdapter(file, () => '2026-01-01T00:00:00.000Z');
    const created = await adapter.create({ id: '', title: 'one', status: 'pending', updatedAt: '' });
    expect(created.id).toBe('FILE-1');
    expect((await adapter.list('p'))[0].title).toBe('one');

    const updated = await adapter.update('FILE-1', { title: 'two' });
    expect(updated.title).toBe('two');
    const reloaded = new FileTrackerAdapter(file);
    expect((await reloaded.list('p'))[0].title).toBe('two');
  });
});
