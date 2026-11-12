import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { uninstallAgent } from '../src/cli/uninstall-agent.js';

describe('DX-26c uninstall', () => {
  function setup() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dx26c-'));
    const managed = path.join(home, '.local', 'share', 'mcp-task-knowledge', 'skill.md');
    fs.mkdirSync(path.dirname(managed), { recursive: true });
    fs.writeFileSync(managed, 'demo\n');
    const config = path.join(home, '.config', 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ mcp: { 'mcp-task-knowledge': { type: 'local' }, other: {} } }, null, 2));
    const sha = createHash('sha256').update(fs.readFileSync(managed)).digest('hex');
    const manifest = path.join(home, '.mcp-task-knowledge', 'opencode-install-manifest.json');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({
      schema: 1,
      client: 'opencode',
      bundleVersion: '1.0.20',
      installedAt: new Date().toISOString(),
      files: [
        { target: managed, sha256: sha, backupRel: null, config: false },
        { target: config, sha256: 'unused', backupRel: null, config: true },
      ],
    }));
    return { home, managed, config, manifest };
  }

  it('removes managed files and the config entry', () => {
    const { home, managed, config, manifest } = setup();
    const result = uninstallAgent('opencode', home, {}, false);
    expect(result.removedFiles).toBe(1);
    expect(result.removedConfigEntry).toBe(true);
    expect(fs.existsSync(managed)).toBe(false);
    expect(fs.existsSync(manifest)).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(config, 'utf8'));
    expect(parsed.mcp['mcp-task-knowledge']).toBeUndefined();
    expect(parsed.mcp.other).toEqual({});
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('dry-run changes nothing', () => {
    const { home, managed, config, manifest } = setup();
    const result = uninstallAgent('opencode', home, {}, true);
    expect(result.dryRun).toBe(true);
    expect(result.removedFiles).toBe(1);
    expect(fs.existsSync(managed)).toBe(true);
    expect(fs.existsSync(manifest)).toBe(true);
    expect(JSON.parse(fs.readFileSync(config, 'utf8')).mcp['mcp-task-knowledge']).toBeTruthy();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('returns zero when no manifest exists', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dx26c-empty-'));
    expect(uninstallAgent('claude-code', home, {}, false).removedFiles).toBe(0);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
