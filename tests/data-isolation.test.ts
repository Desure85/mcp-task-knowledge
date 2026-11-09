/**
 * TS-02 guard: two test files must never share one DATA_DIR.
 *
 * tests/setup.ts appends one `{pid, dataDir}` line per test file to
 * `<tmp>/mcp-vitest-registry-<ppid>.jsonl`; this spec asserts that no two
 * lines carry the same DATA_DIR. The name is rebuilt here instead of imported
 * because importing the setup module would run it a second time.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface RegistryEntry {
  pid: number;
  dataDir: string;
}

const REGISTRY = path.join(os.tmpdir(), `mcp-vitest-registry-${process.ppid}.jsonl`);

function readRegistry(): RegistryEntry[] {
  let raw = '';
  try {
    raw = fs.readFileSync(REGISTRY, 'utf8');
  } catch {
    return [];
  }
  const entries: RegistryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<RegistryEntry>;
      if (typeof parsed.pid === 'number' && typeof parsed.dataDir === 'string') {
        entries.push({ pid: parsed.pid, dataDir: parsed.dataDir });
      }
    } catch {
      // A line still being appended by a parallel worker: skip it, the next run sees it whole.
    }
  }
  return entries;
}

describe('TS-02: DATA_DIR isolation between test files', () => {
  it('gives this file a private DATA_DIR outside the repository', () => {
    const dir = process.env.DATA_DIR ?? '';
    expect(dir.startsWith(path.join(os.tmpdir(), 'mcp-vitest-'))).toBe(true);
    expect(dir.startsWith(process.cwd() + path.sep)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('never assigns one DATA_DIR to two test files', () => {
    const entries = readRegistry();
    expect(entries.map((e) => e.dataDir)).toContain(process.env.DATA_DIR);
    const dirs = entries.map((e) => e.dataDir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});
