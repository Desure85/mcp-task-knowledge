import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runInstallAgent, type Bundle } from '../src/cli/install-agent.js';

const REPO = process.cwd();
const BUNDLE = path.join(REPO, 'bundle.json');
let home = '';

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function sha(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

function copyBundle(mutator: (bundle: Bundle) => void): string {
  const bundle = readJson<Bundle>(BUNDLE);
  mutator(bundle);
  const file = path.join(home, 'bundle-test.json');
  fs.writeFileSync(file, JSON.stringify(bundle));
  return file;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aa07-home-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('AA-07 install-agent', () => {
  it('keeps bundle hashes equal to the real sources', () => {
    const bundle = readJson<Bundle>(BUNDLE);
    expect(bundle.schema).toBe(1);
    expect(bundle.server.sha256).toBe(sha(path.join(REPO, 'package.json')));
    for (const component of bundle.components) {
      expect(component.sha256, component.source).toBe(sha(path.join(REPO, component.source)));
    }
  });

  it('dry-run plans without writing anything', () => {
    const result = runInstallAgent(['--client', 'opencode', '--home', home, '--dry-run'], { cwd: REPO });
    expect(result.exitCode).toBe(0);
    expect(result.text).toContain('dry-run (no writes)');
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('installs opencode files and config idempotently', () => {
    const first = runInstallAgent(['--client', 'opencode', '--home', home], { cwd: REPO });
    expect(first.exitCode).toBe(0);
    const config = readJson<{ mcp: Record<string, unknown> }>(path.join(home, '.config', 'opencode', 'opencode.json'));
    expect(config.mcp['mcp-task-knowledge']).toMatchObject({ type: 'local', command: ['npx', '-y', 'mcp-task-knowledge@1.0.20'] });
    expect(fs.existsSync(path.join(home, '.config', 'opencode', 'plugins', 'memory-recall.ts'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.local', 'share', 'mcp-task-knowledge', 'proxy', 'shim.js'))).toBe(true);

    const manifest = readJson<{ files: Array<{ target: string; sha256: string }> }>(
      path.join(home, '.mcp-task-knowledge', 'opencode-install-manifest.json'),
    );
    expect(manifest.files).toHaveLength(12);
    for (const file of manifest.files) expect(sha(path.join(home, file.target))).toBe(file.sha256);

    const second = runInstallAgent(['--client', 'opencode', '--home', home], { cwd: REPO });
    expect(second.exitCode).toBe(0);
    expect(second.text).toBe('no changes');
  });

  it('preserves an existing client config and conflicting file, then restores both on rollback', () => {
    const opencode = path.join(home, '.config', 'opencode');
    fs.mkdirSync(path.join(opencode, 'plugins'), { recursive: true });
    const configFile = path.join(opencode, 'opencode.json');
    const originalConfig = { model: 'keep-me', mcp: { other: { type: 'local', command: ['echo'] } } };
    fs.writeFileSync(configFile, JSON.stringify(originalConfig));
    const pluginFile = path.join(opencode, 'plugins', 'memory-recall.ts');
    fs.writeFileSync(pluginFile, '// local custom plugin\n');

    expect(runInstallAgent(['--client', 'opencode', '--home', home], { cwd: REPO }).exitCode).toBe(0);
    const merged = readJson<{ model: string; mcp: { other: unknown } }>(configFile);
    expect(merged.model).toBe('keep-me');
    expect(merged.mcp.other).toBeTruthy();
    expect(fs.readFileSync(pluginFile, 'utf8')).toContain('memory-recall');

    const rollback = runInstallAgent(['--client', 'opencode', '--home', home, '--rollback'], { cwd: REPO });
    expect(rollback.exitCode).toBe(0);
    expect(readJson(configFile)).toEqual(originalConfig);
    expect(fs.readFileSync(pluginFile, 'utf8')).toBe('// local custom plugin\n');
    expect(fs.existsSync(path.join(home, '.config', 'opencode', 'plugins', 'memory-dream.ts'))).toBe(false);
  });

  it('installs the Claude Code command and config without opencode plugins', () => {
    const result = runInstallAgent(['--client', 'claude-code', '--home', home], { cwd: REPO });
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(home, '.claude', 'commands', 'end-session.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude', 'plugins'))).toBe(false);
    const config = readJson<{ mcpServers: Record<string, unknown> }>(path.join(home, '.claude.json'));
    expect(config.mcpServers['mcp-task-knowledge']).toEqual({ command: 'npx', args: ['-y', 'mcp-task-knowledge@1.0.20'] });
  });

  it('aborts before writing on a hash mismatch or unsafe target', () => {
    const badHash = copyBundle((bundle) => { bundle.components[0].sha256 = '0'.repeat(64); });
    const mismatch = runInstallAgent(['--client', 'opencode', '--home', home], { cwd: REPO, bundlePath: badHash });
    expect(mismatch.exitCode).toBe(2);
    expect(mismatch.text).toContain('bundle hash mismatch');
    expect(fs.readdirSync(home).filter((name) => name !== 'bundle-test.json')).toEqual([]);

    const traversal = copyBundle((bundle) => {
      const target = bundle.components.find((component) => component.targets.opencode);
      if (target?.targets.opencode) target.targets.opencode.path = '../escape.ts';
    });
    const escaped = runInstallAgent(['--client', 'opencode', '--home', home], { cwd: REPO, bundlePath: traversal });
    expect(escaped.exitCode).toBe(2);
    expect(escaped.text).toContain('unsafe bundle path');
  });

  it('dispatches install-agent from the built CLI without DATA_DIR', () => {
    const out = execFileSync(process.execPath, [path.join(REPO, 'dist', 'index.js'), 'install-agent', '--client', 'opencode', '--home', home, '--dry-run'], {
      cwd: home,
      env: { ...process.env, DATA_DIR: '' },
      encoding: 'utf8',
    });
    expect(out).toContain('dry-run (no writes)');
  });

  it('does not let an XDG dir outside --home escape the target root', () => {
    const outside = path.join(home, '..', `xdg-${path.basename(home)}`);
    const result = runInstallAgent(['--client', 'opencode', '--home', home, '--dry-run'], {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: outside, XDG_DATA_HOME: outside },
    });
    expect(result.exitCode).toBe(0);
    expect(result.actions.every((action) => action.target.startsWith(home + path.sep))).toBe(true);
  });

  it('rejects a missing or unknown client', () => {
    expect(runInstallAgent(['--home', home], { cwd: REPO }).exitCode).toBe(2);
    expect(runInstallAgent(['--client', 'emacs', '--home', home], { cwd: REPO }).exitCode).toBe(2);
  });
});
