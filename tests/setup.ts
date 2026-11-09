/**
 * Global test setup — sets env vars required by config.ts
 * before any module that imports config.ts is loaded.
 *
 * config.ts throws if DATA_DIR is not set at module evaluation time.
 * This setup runs before any test file imports are resolved.
 *
 * TS-02: every test file gets its OWN DATA_DIR. Until TS-02 all files shared
 * one `<cwd>/.tmp-vitest`, so suites running in parallel (and suites running
 * after earlier runs) saw each other's tasks, knowledge, `.state.json`,
 * `.jwt-revoked.json` and `.index/metadata.db`. Vitest executes setup files
 * once per test file, so `mkdtempSync` here is per-file by construction.
 *
 * The directory is removed in `afterAll`; a crashed worker cannot run the
 * hook, so a prefix-scoped sweep drops leftovers older than SWEEP_AGE_MS.
 * The sweep never touches anything outside its own prefix.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/** Prefix of every directory and registry file this setup creates. */
const RUN_PREFIX = 'mcp-vitest-';

/** Leftovers younger than this may still belong to a live run. */
const SWEEP_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * `(pid → DATA_DIR)` lines for the current vitest run, one per test file.
 * `tests/data-isolation.test.ts` reads it to prove that no two files share a
 * DATA_DIR. The file name is keyed by the parent process, so concurrent runs
 * (and the previous run) never mix.
 */
export const DATA_DIR_REGISTRY = path.join(os.tmpdir(), `${RUN_PREFIX}registry-${process.ppid}.jsonl`);

function sweepStale(now: number): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(RUN_PREFIX)) continue;
    const full = path.join(os.tmpdir(), name);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs < SWEEP_AGE_MS) continue;
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // A concurrent run may have removed it first, or it is not ours to touch.
    }
  }
}

sweepStale(Date.now());

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), RUN_PREFIX));

process.env.DATA_DIR = tmpDir;
// Tests must not pick up a model from the developer's home directory.
process.env.EMBEDDINGS_AUTODETECT = '0';
process.env.OBSIDIAN_VAULT_ROOT = path.join(tmpDir, 'vault');
fs.mkdirSync(process.env.OBSIDIAN_VAULT_ROOT, { recursive: true });

// Record this file's directory for the isolation guard. A failure here must not
// take down every suite: the guard reports the missing entry instead.
try {
  fs.appendFileSync(DATA_DIR_REGISTRY, `${JSON.stringify({ pid: process.pid, dataDir: tmpDir })}\n`);
} catch {
  /* guarded by tests/data-isolation.test.ts */
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
