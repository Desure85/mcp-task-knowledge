import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  exportPluginPackage,
  PluginPackageError,
  readPluginPackage,
} from '../src/skills/plugin-container.js';

const cleanup: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-z02-'));
  cleanup.push(dir);
  return dir;
}

function write(root: string, relative: string, content: string | Buffer): void {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture(manifestExtra: Record<string, unknown> = {}): string {
  const root = tempDir();
  write(root, 'plugin.json', `${JSON.stringify({
    name: 'demo-plugin',
    version: '1.2.3',
    description: 'Demo',
    components: {
      skills: ['skills/review/SKILL.md'],
      commands: ['commands/run.md'],
      agents: ['agents/reviewer.md'],
      hooks: ['hooks/hooks.json'],
      mcp: ['.mcp.json'],
    },
    ...manifestExtra,
  }, null, 2)}\n`);
  write(root, 'skills/review/SKILL.md', '---\nname: review\ndescription: Review\n---\nReview body\n');
  write(root, 'skills/review/references/notes.md', 'attachment\n');
  write(root, 'commands/run.md', 'Run command\n');
  write(root, 'agents/reviewer.md', 'Agent prompt\n');
  write(root, 'hooks/hooks.json', '{"hooks":[]}\n');
  write(root, '.mcp.json', '{"mcpServers":{}}\n');
  write(root, 'assets/logo.bin', Buffer.from([0, 1, 2, 255, 254]));
  return root;
}

afterEach(() => {
  for (const dir of cleanup.splice(0).reverse()) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Z-02: plugin container import/export', () => {
  it('reads every component plus undeclared attachments', () => {
    const pkg = readPluginPackage(fixture());
    expect(pkg.manifest.name).toBe('demo-plugin');
    expect(pkg.manifest.version).toBe('1.2.3');
    const byPath = new Map(pkg.files.map((file) => [file.path, file]));
    expect(byPath.get('skills/review/SKILL.md')?.component).toBe('skills');
    expect(byPath.get('skills/review/references/notes.md')?.component).toBe('skills');
    expect(byPath.get('commands/run.md')?.component).toBe('commands');
    expect(byPath.get('agents/reviewer.md')?.component).toBe('agents');
    expect(byPath.get('hooks/hooks.json')?.component).toBe('hooks');
    expect(byPath.get('.mcp.json')?.component).toBe('mcp');
    expect(byPath.get('assets/logo.bin')?.component).toBe('other');
    expect(byPath.get('assets/logo.bin')?.size).toBe(5);
  });

  it('round-trips the whole directory, including binary attachments', () => {
    const source = fixture();
    const dest = path.join(tempDir(), 'exported');
    const exported = exportPluginPackage(source, dest);
    const before = readPluginPackage(source);

    expect(exported.files.map((file) => file.path).sort()).toEqual(before.files.map((file) => file.path).sort());
    expect(exported.files.map((file) => [file.path, file.sha256]).sort()).toEqual(
      before.files.map((file) => [file.path, file.sha256]).sort(),
    );
    expect(fs.readFileSync(path.join(dest, 'assets', 'logo.bin'))).toEqual(Buffer.from([0, 1, 2, 255, 254]));
    expect(fs.readFileSync(path.join(dest, 'commands', 'run.md'), 'utf8')).toContain('Run command');
  });

  it('refuses to overwrite an existing destination', () => {
    const source = fixture();
    const dest = tempDir();
    expect(() => exportPluginPackage(source, dest)).toThrowError(
      expect.objectContaining({ code: 'DEST_EXISTS' }),
    );
  });

  it('rejects a declared component outside its component directory', () => {
    const root = fixture({ components: { commands: ['skills/review/SKILL.md'] } });
    let error: unknown;
    try {
      readPluginPackage(root);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PluginPackageError);
    expect((error as PluginPackageError).code).toBe('COMPONENT_INVALID');
  });

  it('rejects missing manifests, traversal paths and unknown components', () => {
    const missing = tempDir();
    write(missing, 'commands/run.md', 'x');
    expect(() => readPluginPackage(missing)).toThrowError(expect.objectContaining({ code: 'MANIFEST_MISSING' }));

    const traversal = fixture({ components: { commands: ['../outside.md'] } });
    expect(() => readPluginPackage(traversal)).toThrowError(expect.objectContaining({ code: 'COMPONENT_INVALID' }));

    const unknown = fixture({ components: { plugins: ['commands/run.md'] } });
    expect(() => readPluginPackage(unknown)).toThrowError(expect.objectContaining({ code: 'COMPONENT_INVALID' }));
  });
});
