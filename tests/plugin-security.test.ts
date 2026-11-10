import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPluginPackage } from '../src/skills/plugin-container.js';
import {
  activatePluginPackage,
  inspectPluginSecurity,
  pluginLicenseWarning,
  PluginSecurityError,
} from '../src/skills/plugin-security.js';

const cleanup: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-z04-'));
  cleanup.push(dir);
  return dir;
}

function write(root: string, relative: string, content: string): void {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture(options: { license?: boolean } = {}): string {
  const root = tempDir();
  write(root, 'plugin.json', `${JSON.stringify({
    name: 'security-demo',
    version: '1.0.0',
    ...(options.license === false ? {} : { license: 'MIT' }),
    components: {
      skills: ['skills/review/SKILL.md'],
      hooks: ['hooks/hooks.json'],
      mcp: ['.mcp.json'],
    },
  }, null, 2)}\n`);
  write(root, 'skills/review/SKILL.md', '---\nname: review\n---\nReview\n');
  write(root, 'skills/review/scripts/run.sh', '#!/bin/sh\necho hi\n');
  write(root, 'hooks/hooks.json', '{"hooks":[]}\n');
  write(root, '.mcp.json', '{"mcpServers":{"remote":{"url":"https://example.com/mcp"}}}\n');
  if (options.license !== false) write(root, 'LICENSE', 'MIT\n');
  return root;
}

afterEach(() => {
  for (const dir of cleanup.splice(0).reverse()) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Z-04: plugin package security', () => {
  it('marks every file external and surfaces scripts, hooks, mcp and network explicitly', () => {
    const pkg = readPluginPackage(fixture());
    const report = inspectPluginSecurity(pkg);

    expect(report.trustLevel).toBe('external');
    expect(report.files.every((file) => file.trustLevel === 'external')).toBe(true);
    expect(report.files.every((file) => file.enabled === false)).toBe(true);
    expect(report.hooks).toContain('hooks/hooks.json');
    expect(report.mcpConfig).toBe('.mcp.json');
    expect(report.executableFiles).toContain('skills/review/scripts/run.sh');
    expect(report.networkFiles).toContain('.mcp.json');
    expect(report.license.file).toBe('LICENSE');
    expect(pluginLicenseWarning(report)).toBeNull();
  });

  it('enables nothing by default and refuses hooks without explicit permission', () => {
    const pkg = readPluginPackage(fixture());
    const defaultActivation = activatePluginPackage(pkg);
    expect(defaultActivation.enabledComponents).toEqual([]);
    expect(defaultActivation.enabledFiles).toEqual([]);
    expect(defaultActivation.networkEnabled).toBe(false);

    let denied: unknown;
    try {
      activatePluginPackage(pkg, { enableComponents: ['hooks'] });
    } catch (error) {
      denied = error;
    }
    expect(denied).toBeInstanceOf(PluginSecurityError);
    expect((denied as PluginSecurityError).code).toBe('ACTIVATION_DENIED');

    const hooks = activatePluginPackage(pkg, { enableComponents: ['hooks'], allowHooks: true });
    expect(hooks.enabledComponents).toEqual(['hooks']);
    expect(hooks.enabledFiles).toContain('hooks/hooks.json');
  });

  it('requires allowScripts for components with executable files and allowMcp for .mcp.json', () => {
    const pkg = readPluginPackage(fixture());
    expect(() => activatePluginPackage(pkg, { enableComponents: ['skills'] })).toThrowError(
      expect.objectContaining({ code: 'ACTIVATION_DENIED' }),
    );
    expect(() => activatePluginPackage(pkg, { enableComponents: ['mcp'] })).toThrowError(
      expect.objectContaining({ code: 'ACTIVATION_DENIED' }),
    );
    const ok = activatePluginPackage(pkg, { enableComponents: ['mcp'], allowMcp: true });
    expect(ok.enabledFiles).toContain('.mcp.json');
  });

  it('keeps network off unless requested and reports it separately', () => {
    const pkg = readPluginPackage(fixture());
    const noNetwork = activatePluginPackage(pkg, { enableComponents: ['hooks'], allowHooks: true });
    expect(noNetwork.networkEnabled).toBe(false);

    const withNetwork = activatePluginPackage(pkg, {
      enableComponents: ['skills'],
      allowScripts: true,
      allowNetwork: true,
    });
    expect(withNetwork.networkEnabled).toBe(true);
    expect(withNetwork.report.networkFiles).toContain('.mcp.json');
  });

  it('warns when a license is absent', () => {
    const report = inspectPluginSecurity(readPluginPackage(fixture({ license: false })));
    expect(report.warnings).toContain('LICENSE_MISSING');
    expect(report.license).toEqual({});
    expect(pluginLicenseWarning(report)).toMatch(/no declared license/i);
  });
});
