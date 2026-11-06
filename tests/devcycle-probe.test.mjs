/**
 * tests/devcycle-probe.test.mjs — decisions catalog reading and its guards.
 *
 * Three things are asserted:
 *   1. `probeDecisions` reads docs/dev-cycle/decisions/ (one file per decision),
 *      sorts by file name, returns the last N newest first and ignores README.
 *   2. It falls back to the legacy docs/dev-cycle/decisions-log.md only when the
 *      catalog directory is absent.
 *   3. The repository catalog obeys its own contract: file name mask, name time
 *      equal to the heading time, full field set in new records, and the
 *      decisions-log.md pointer never regains records.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { probeDecisions } from '../scripts/lib/devcycle-probe.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const CATALOG = path.join(REPO, 'docs', 'dev-cycle', 'decisions');
const POINTER = path.join(REPO, 'docs', 'dev-cycle', 'decisions-log.md');
const NAME_MASK = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9-]+\.md$/;
const FIELDS = ['Вопрос', 'Решение', 'Почему', 'Проверено', 'Откат'];

const tempDirs = [];

async function makeRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devcycle-probe-'));
  tempDirs.push(dir);
  return dir;
}

async function writeCatalog(repo, files) {
  const dir = path.join(repo, 'docs', 'dev-cycle', 'decisions');
  await fs.mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), text, 'utf8');
  }
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('probeDecisions catalog mode', () => {
  it('reads the last N files by name, newest first, and skips README', async () => {
    const repo = await makeRepo();
    await writeCatalog(repo, {
      'README.md': '# How to add\n',
      '2026-01-01-0100-alpha.md': '# 2026-01-01 01:00, alpha\n\nbody alpha\n',
      '2026-01-02-0200-beta.md': '# 2026-01-02 02:00, beta\n\nbody beta\n',
      '2026-01-03-0300-gamma.md': '# 2026-01-03 03:00, gamma\n\nbody gamma\n',
    });

    const two = await probeDecisions(repo, { limit: 2 });
    expect(two.available).toBe(true);
    expect(two.items).toEqual(['2026-01-03 03:00, gamma', '2026-01-02 02:00, beta']);

    const all = await probeDecisions(repo, { limit: 10 });
    expect(all.items).toHaveLength(3);
    expect(all.items[0]).toBe('2026-01-03 03:00, gamma');
  });

  it('sorts file names regardless of the readdir order', async () => {
    const repo = await makeRepo();
    await writeCatalog(repo, {
      'README.md': '# How to add\n',
      '2026-01-01-0100-alpha.md': '# 2026-01-01 01:00, alpha\n',
      '2026-01-02-0200-beta.md': '# 2026-01-02 02:00, beta\n',
      '2026-01-03-0300-gamma.md': '# 2026-01-03 03:00, gamma\n',
    });
    // The contract must not depend on the order the file system returns names in.
    const readdir = vi.spyOn(fs, 'readdir').mockResolvedValue([
      '2026-01-03-0300-gamma.md',
      'README.md',
      '2026-01-01-0100-alpha.md',
      '2026-01-02-0200-beta.md',
    ]);

    const result = await probeDecisions(repo, { limit: 2 });

    expect(readdir).toHaveBeenCalled();
    expect(result.items).toEqual(['2026-01-03 03:00, gamma', '2026-01-02 02:00, beta']);
  });

  it('defaults to three entries and treats an empty catalog as available', async () => {
    const repo = await makeRepo();
    await writeCatalog(repo, {
      '2026-01-01-0100-alpha.md': '# 2026-01-01 01:00, alpha\n',
      '2026-01-02-0200-beta.md': '# 2026-01-02 02:00, beta\n',
      '2026-01-03-0300-gamma.md': '# 2026-01-03 03:00, gamma\n',
      '2026-01-04-0400-delta.md': '# 2026-01-04 04:00, delta\n',
    });
    const def = await probeDecisions(repo);
    expect(def.items).toHaveLength(3);
    expect(def.items[0]).toBe('2026-01-04 04:00, delta');

    const emptyRepo = await makeRepo();
    await writeCatalog(emptyRepo, {});
    const empty = await probeDecisions(emptyRepo, { limit: 3 });
    expect(empty).toEqual({ available: true, items: [] });
  });
});

describe('probeDecisions legacy fallback', () => {
  it('reads decisions-log.md only when the catalog directory is absent', async () => {
    const repo = await makeRepo();
    await fs.mkdir(path.join(repo, 'docs', 'dev-cycle'), { recursive: true });
    await fs.writeFile(
      path.join(repo, 'docs', 'dev-cycle', 'decisions-log.md'),
      '# Журнал\n\n### 2026-01-01, older\n\n### 2026-01-02, newest\n',
      'utf8',
    );

    const one = await probeDecisions(repo, { limit: 1 });
    expect(one).toEqual({ available: true, items: ['2026-01-02, newest'] });
  });

  it('does not resurrect the aggregate log when the catalog exists', async () => {
    const repo = await makeRepo();
    await writeCatalog(repo, { '2026-01-01-0100-alpha.md': '# alpha\n' });
    await fs.writeFile(
      path.join(repo, 'docs', 'dev-cycle', 'decisions-log.md'),
      '### 2026-01-02, legacy entry\n',
      'utf8',
    );
    const result = await probeDecisions(repo, { limit: 5 });
    expect(result.items).toEqual(['alpha']);
  });
});

describe('repository decisions catalog contract', () => {
  it('keeps one file per decision, named by date, time key and id slug', async () => {
    const entries = (await fs.readdir(CATALOG)).filter((name) => name.endsWith('.md'));
    const files = entries.filter((name) => name !== 'README.md').sort();
    expect(entries).toContain('README.md');
    expect(files.length).toBeGreaterThanOrEqual(24);
    for (const name of files) {
      expect(name).toMatch(NAME_MASK);
    }
  });

  it('keeps name time equal to the heading time and preserves chronological file order', async () => {
    const files = (await fs.readdir(CATALOG))
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .sort();
    let previousDate = '';
    let previousKey = '';
    for (const name of files) {
      const text = await fs.readFile(path.join(CATALOG, name), 'utf8');
      const heading = text.split('\n')[0];
      expect(heading.startsWith('# ')).toBe(true);
      const date = name.slice(0, 10);
      const key = name.slice(11, 15);
      expect(date >= previousDate).toBe(true);
      if (date === previousDate) expect(key >= previousKey).toBe(true);
      previousDate = date;
      previousKey = key;

      const timed = heading.match(/^# (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
      if (timed) {
        expect(date).toBe(timed[1]);
        expect(key).toBe(`${timed[2]}${timed[3]}`);
      }
    }
  });

  it('requires all five fields in records created from 2026-11-07 on', async () => {
    const files = (await fs.readdir(CATALOG))
      .filter((name) => name.endsWith('.md') && name !== 'README.md' && name >= '2026-11-07')
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = await fs.readFile(path.join(CATALOG, name), 'utf8');
      for (const field of FIELDS) {
        expect(text, `${name} is missing ${field}`).toContain(field);
      }
    }
  });

  it('keeps decisions-log.md a pointer without records', async () => {
    const text = await fs.readFile(POINTER, 'utf8');
    expect(text.split('\n')[0].startsWith('# ')).toBe(true);
    expect(text.split('\n').some((line) => line.startsWith('### '))).toBe(false);
    expect(text).toContain('decisions/README.md');
  });
});
