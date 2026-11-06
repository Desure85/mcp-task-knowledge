/**
 * DX-16b — `dev-cli restore` end to end. Spawns the real CLI against a
 * temporary DATA_DIR: no server, no ports, no shared state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDistFresh } from './support/dist-guard.js';

const CLI = path.join(process.cwd(), 'scripts/dev-cli.mjs');

let ROOT: string;
let DATA: string;
let OUT: string;

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [CLI, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATA_DIR: DATA,
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
      ...env,
    },
  });
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(DATA, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content);
}

async function read(rel: string): Promise<string> {
  return fsp.readFile(path.join(DATA, rel), 'utf8');
}

beforeEach(async () => {
  ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'dx16b-cli-'));
  DATA = path.join(ROOT, 'data');
  OUT = path.join(ROOT, 'out');
  await write('tasks/acme/t1.json', '{"id":"t1","title":"one"}\n');
  await write('knowledge/acme/d1.md', 'body one\n');
});

afterEach(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
});

describe('dev-cli restore', () => {
  it('prints a plan and an apply token by default, and applies only with --confirm', async () => {
    assertDistFresh();
    const backup = run(['backup', '--out', OUT, '--label', 'cli']);
    expect(backup.status, backup.stderr).toBe(0);
    const archive = (backup.stdout.match(/Archive: (.+)/)?.[1] ?? '').trim();
    expect(archive.endsWith('.tar.gz')).toBe(true);

    await write('tasks/acme/t1.json', '{"id":"t1","title":"CHANGED"}\n');
    await write('knowledge/acme/d2.md', 'after\n');

    const dry = run(['restore', archive]);
    expect(dry.status, dry.stderr).toBe(0);
    const token = dry.stdout.match(/Apply token: ([0-9a-f]+)/)?.[1];
    expect(token).toBeTruthy();
    expect(dry.stdout).toContain('Nothing was changed');
    expect(await read('tasks/acme/t1.json')).toContain('CHANGED');
    expect(await read('knowledge/acme/d2.md')).toBe('after\n');

    const apply = run(['restore', archive, '--confirm', token as string]);
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain('Restored files: 2');
    expect(await read('tasks/acme/t1.json')).toBe('{"id":"t1","title":"one"}\n');
    await expect(fsp.access(path.join(DATA, 'knowledge/acme/d2.md'))).rejects.toThrow();
    await expect(fsp.access(path.join(DATA, '.restore.lock'))).rejects.toThrow();
  });

  it('refuses to run without DATA_DIR instead of inventing a temporary one', () => {
    assertDistFresh();
    const result = run(['restore', '/nonexistent.tgz'], { DATA_DIR: '' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('DATA_DIR is required');
  });
});
