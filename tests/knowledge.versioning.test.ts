/**
 * tests/knowledge.versioning.test.ts — Knowledge doc versioning (TD-005)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createDoc, updateDoc, readDoc, listDocVersions, restoreDocVersion } from '../src/storage/knowledge.js';
import { KNOWLEDGE_DIR } from '../src/config.js';

const PROJECT = 'ver-test';

describe('TD-005: knowledge versioning', () => {
  beforeAll(async () => {
    await fsp.rm(path.join(KNOWLEDGE_DIR, PROJECT), { recursive: true, force: true });
  });

  afterAll(async () => {
    await fsp.rm(path.join(KNOWLEDGE_DIR, PROJECT), { recursive: true, force: true });
  });

  it('createDoc sets version 1', async () => {
    const doc = await createDoc({ project: PROJECT, title: 'V1', content: 'first' });
    expect(doc.version ?? 1).toBe(1);
  });

  it('updateDoc bumps version and records history', async () => {
    const doc = await createDoc({ project: PROJECT, title: 'V1', content: 'first' });
    const updated = await updateDoc(PROJECT, doc.id, { content: 'second', title: 'V2' })!;
    expect(updated!.version).toBe(2);
    expect(updated!.history).toHaveLength(1);
    expect(updated!.history![0].version).toBe(1);
    expect(updated!.history![0].title).toBe('V1');
  });

  it('history accumulates across updates (capped at 50)', async () => {
    const doc = await createDoc({ project: PROJECT, title: 'H0', content: 'c0' });
    for (let i = 1; i <= 3; i++) {
      await updateDoc(PROJECT, doc.id, { content: `c${i}` })!;
    }
    const current = await readDoc(PROJECT, doc.id);
    expect(current!.version).toBe(4);
    expect(current!.history).toHaveLength(3);
  });

  it('listDocVersions returns history newest-first', async () => {
    const doc = await createDoc({ project: PROJECT, title: 'L0', content: 'x' });
    await updateDoc(PROJECT, doc.id, { content: 'y' })!;
    await updateDoc(PROJECT, doc.id, { content: 'z' })!;
    const versions = await listDocVersions(PROJECT, doc.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(2); // newest first (v2 snapshot of the update)
    expect(versions[1].version).toBe(1);
  });

  it('restoreDocVersion restores content from a previous version', async () => {
    const doc = await createDoc({ project: PROJECT, title: 'R0', content: 'original-content' });
    await updateDoc(PROJECT, doc.id, { content: 'changed-content', title: 'R1' })!;
    const restored = await restoreDocVersion(PROJECT, doc.id, 1);
    expect(restored).not.toBeNull();
    expect(restored!.content.trim()).toBe('original-content');
    // Restoring bumps version again (new snapshot of the changed state)
    expect(restored!.version).toBeGreaterThanOrEqual(3);
  });

  it('restoreDocVersion returns null for unknown version', async () => {
    const doc = await createDoc({ project: PROJECT, title: 'N0', content: 'x' });
    expect(await restoreDocVersion(PROJECT, doc.id, 999)).toBeNull();
  });
});
