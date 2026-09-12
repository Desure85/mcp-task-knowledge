/**
 * tests/executable-docs.test.ts — DX-24 executable docs regression guard.
 *
 * Runs scripts/executable-docs.mjs as a subprocess and asserts:
 *   - exit code 0 (all validated blocks pass)
 *   - JSON blocks from README/integrations are validated (spot-check via output)
 *   - skip markers are honoured (no-run-marker / doc-test: skip)
 *   - a deliberately broken JSON block in a temp file fails (negative path)
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';

const execFileP = promisify(execFile);
const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts', 'executable-docs.mjs');

async function runScript(extraArgs: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP('node', [SCRIPT, ...extraArgs], { cwd: ROOT, timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (e: any) {
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('executable-docs (DX-24)', () => {
  it('exits 0 on the real repo docs', async () => {
    const r = await runScript();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\d+ passed, 0 failed, \d+ skipped/);
  }, 90_000);

  it('validates JSON blocks from README and integrations', async () => {
    const r = await runScript();
    expect(r.code).toBe(0);
    // README has a ```json mcpServers block
    expect(r.stdout).toMatch(/PASS README\.md:\d+ \[json\]/);
    // integrations.md has several ```json blocks
    expect(r.stdout).toMatch(/PASS docs\/getting-started\/integrations\.md:\d+ \[json\]/);
  }, 90_000);

  it('honours skip markers and no-run-marker default for bash', async () => {
    const r = await runScript();
    expect(r.code).toBe(0);
    // docker/npm-install blocks are skipped (no run marker)
    expect(r.stdout).toMatch(/SKIP README\.md:\d+ \[bash\] \(no-run-marker\)/);
    // pseudo-code TS blocks carry doc-test: skip
    expect(r.stdout).toMatch(/SKIP docs\/features\/web-ui\.md:\d+ \[typescript\] \(marker\)/);
  }, 90_000);

  it('fails on a broken JSON block (negative path)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-test-neg-'));
    try {
      await fs.writeFile(path.join(tmp, 'README.md'), '# x\n\n```json\n{ broken\n```\n');
      const r = await runScript(['--root', tmp]);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/FAIL README\.md:\d+ \[json\]/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('executes bash blocks marked doc-test: run in isolation', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-test-run-'));
    try {
      // A run-marked block that writes into cwd — must land in temp, not repo
      await fs.writeFile(
        path.join(tmp, 'README.md'),
        '# x\n\n<!-- doc-test: run -->\n```bash\necho hi > marker.txt\n```\n'
      );
      const r = await runScript(['--root', tmp]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/PASS README\.md:\d+ \[bash\]/);
      // marker.txt must NOT leak into the scanned root
      await expect(fs.access(path.join(tmp, 'marker.txt'))).rejects.toThrow();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
