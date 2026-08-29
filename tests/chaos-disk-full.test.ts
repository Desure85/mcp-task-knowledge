/**
 * tests/chaos-disk-full.test.ts — Disk-full (ENOSPC) data integrity tests (Q-013)
 *
 * Verifies the atomic write guarantee in src/fs.ts: when a write fails
 * mid-operation (ENOSPC simulation), the previously stored file must remain
 * intact and no partial/tmp files may linger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeJson, readJson } from '../src/fs.js';

describe('Q-013: ENOSPC data integrity', () => {
  const dir = path.join(process.cwd(), '.tmp-enospc');
  const file = path.join(dir, 'task.json');

  beforeEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('existing file survives a failed write (ENOSPC)', async () => {
    // Seed a valid file
    const original = { id: 't1', title: 'intact', status: 'pending' };
    await writeJson(file, original);

    // Simulate ENOSPC on the NEXT write (only the tmp write fails)
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    );

    await expect(writeJson(file, { id: 't2', title: 'never lands' })).rejects.toThrow('ENOSPC');
    expect(writeFileSpy).toHaveBeenCalledOnce();

    // The original file must be untouched (atomic write = no partial overwrite)
    const after = await readJson<typeof original>(file);
    expect(after).toEqual(original);

    // No tmp files may linger
    const leftovers = (await fs.readdir(dir)).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('failed rename leaves no partial file and original intact', async () => {
    const original = { id: 't1', title: 'still here' };
    await writeJson(file, original);

    // Simulate rename failure (e.g. disk full at commit time)
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }),
    );

    await expect(writeJson(file, { id: 't2' })).rejects.toThrow('ENOSPC');

    const after = await readJson<typeof original>(file);
    expect(after).toEqual(original);

    const leftovers = (await fs.readdir(dir)).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('successful write replaces content and cleans tmp', async () => {
    await writeJson(file, { id: 'old' });
    await writeJson(file, { id: 'new', ok: true });

    const after = await readJson<{ id: string; ok?: boolean }>(file);
    expect(after.id).toBe('new');
    expect(after.ok).toBe(true);

    const leftovers = (await fs.readdir(dir)).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
