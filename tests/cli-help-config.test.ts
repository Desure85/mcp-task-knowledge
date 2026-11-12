import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENTRY = path.join(process.cwd(), 'dist', 'index.js');

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: 'utf8',
    env,
    timeout: 20_000,
  });
}

describe('DX-26a CLI: --help and config show', () => {
  it('prints usage without DATA_DIR and exits 0', () => {
    const env = { ...process.env };
    delete env.DATA_DIR;
    const result = run(['--help'], env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mcp-task-knowledge');
    expect(result.stdout).toContain('config show');
  });

  it('prints effective config as JSON with DATA_DIR set', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dx26a-'));
    const result = run(['config', 'show'], {
      ...process.env,
      DATA_DIR: dataDir,
      EMBEDDINGS_MODE: 'none',
      OBSIDIAN_VAULT_ROOT: path.join(dataDir, 'vault'),
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.embeddings).toBeTruthy();
    expect(parsed.obsidian).toBeTruthy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('fails config show with an actionable hint when DATA_DIR is missing', () => {
    const env = { ...process.env };
    delete env.DATA_DIR;
    const result = run(['config', 'show'], env);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('DATA_DIR');
  });
});
