import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AwesomeListSource, McpRegistrySource } from '../src/prompts/sources.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'z08-sources-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('Z-08 external prompt sources', () => {
  it('reads an awesome list, reports license and imports a stub', async () => {
    const root = path.join(tmp, 'awesome');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT\n');
    fs.writeFileSync(path.join(root, 'README.md'), [
      '# Awesome prompts',
      '',
      '- [Browser Debug](https://example.test/browser) — Debug browser sessions',
      '- [Release Notes](https://example.test/release): Draft release notes',
      '- [Browser Debug](https://example.test/dupe) - duplicate title',
      '',
    ].join('\n'));

    const source = new AwesomeListSource(root);
    const items = await source.list('browser');
    expect(items).toHaveLength(2);
    expect(items[0].license).toBe('MIT');
    expect(items.map((i) => i.id)).toEqual(['browser-debug', 'browser-debug-2']);

    const preview = await source.preview('release-notes');
    expect(preview.content).toContain('https://example.test/release');
    expect(preview.content).toContain('License: MIT');

    const target = path.join(tmp, 'imported');
    const imported = await source.import('release-notes', target);
    expect(fs.readFileSync(imported.path, 'utf8')).toContain('Draft release notes');

    const report = await source.licenseReport();
    expect(report.sourceLicense).toBe('MIT');
    expect(report.items).toHaveLength(3);
    expect(report.items.every((i) => i.license === 'MIT')).toBe(true);
  });

  it('reads an MCP registry snapshot and reports per-server licenses', async () => {
    const file = path.join(tmp, 'registry.json');
    fs.writeFileSync(file, JSON.stringify({
      servers: [
        { name: 'io.example/browser', description: 'Browser tools', license: 'MIT', homepage: 'https://example.test/browser' },
        { name: 'io.example/db', description: 'Database tools', license: 'Apache-2.0' },
        { description: 'no name is skipped' },
      ],
    }));
    const source = new McpRegistrySource(file);
    expect((await source.list('database')).map((i) => i.id)).toEqual(['io-example-db']);
    const report = await source.licenseReport();
    expect(report.items.map((i) => [i.id, i.license])).toEqual([
      ['io-example-browser', 'MIT'],
      ['io-example-db', 'Apache-2.0'],
    ]);
    const imported = await source.import('io-example-browser', path.join(tmp, 'registry-import'));
    expect(fs.readFileSync(imported.path, 'utf8')).toContain('License: MIT');
  });
});
