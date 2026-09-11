import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reindexPrompts } from '../src/services/prompts-pipeline.js';

/**
 * PH-001: prompts pipeline in-process (was: spawn node scripts/prompts.mjs —
 * dead in npm package since scripts/ is not shipped).
 * Covers the full chain: index → catalog → services → export-json →
 * export-md → build, on a synthetic prompts tree.
 */

let root: string;
let baseDir: string;
const PROJECT = 'mcp';

function promptFile(id: string, over: Record<string, unknown> = {}) {
  return {
    type: 'prompt',
    id,
    version: '1.0.0',
    metadata: {
      title: `Title ${id}`,
      domain: 'testing',
      status: 'published',
      tags: ['unit', id],
      ...(over.metadata as Record<string, unknown> | undefined),
    },
    template: 'Do the thing with {{var}}',
    variables: [{ name: 'var', type: 'string', required: false }],
    ...(Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'metadata'))),
  };
}

async function writePrompt(rel: string, obj: unknown) {
  const file = path.join(baseDir, PROJECT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
  return file;
}

async function readJson(rel: string) {
  return JSON.parse(await fs.readFile(path.join(baseDir, PROJECT, rel), 'utf8'));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pp-unit-'));
  baseDir = path.join(root, 'prompts-base');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('PH-001: reindexPrompts in-process', () => {
  it('produces index + catalog + services + exports + builds without spawning', async () => {
    await writePrompt('prompts/alpha.json', promptFile('alpha', { metadata: { status: 'draft', domain: 'core' } }));
    await writePrompt('rules/rule-one.json', promptFile('rule-one', { metadata: { kind: 'rule' } }));
    await writePrompt('workflows/wf.json', promptFile('wf', {
      metadata: { kind: 'workflow' },
      compose: [{ ref: 'alpha' }],
      template: undefined,
    }));

    const res = await reindexPrompts({ baseDir, project: PROJECT, projectRoot: root });

    expect(res.errors).toEqual([]);
    expect(res.indexed).toBe(3);
    expect(res.cataloged).toBe(3);
    expect(res.serviceItems).toBe(3);
    expect(res.exportedJson).toBe(3);
    expect(res.exportedMd).toBe(3);
    expect(res.built).toBe(1);

    // index.json — versions/latest + per-file metadata
    const index = await readJson('index.json');
    expect(index.items.alpha.latest).toBe('1.0.0');
    expect(index.items.alpha.status).toBe('draft');
    expect(index.items.alpha.domain).toBe('core');
    expect(index.items['rule-one'].kind).toBe('rule');

    // catalog — metadata preserved (status/domain/tags used by prompts_list filters)
    const catalog = await readJson('exports/catalog/prompts.catalog.json');
    expect(catalog.items.alpha.status).toBe('draft');
    expect(catalog.items.alpha.tags).toContain('unit');
    expect(catalog.items['rule-one'].kind).toBe('rule');

    // services.embedded — id@version entries
    const services = await readJson('exports/catalog/services.embedded.json');
    expect(services.items.map((i: { id: string }) => i.id)).toContain('alpha@1.0.0');

    // exports — json copies + rendered markdown
    const mdAlpha = await fs.readFile(path.join(baseDir, PROJECT, 'exports/markdown/alpha.md'), 'utf8');
    expect(mdAlpha).toContain('# Title alpha');
    expect(mdAlpha).toContain('status: draft');
    const jsonCopy = await readJson('exports/json/alpha.json');
    expect(jsonCopy.id).toBe('alpha');

    // build — workflow composed from referenced prompt
    const wfMd = await fs.readFile(path.join(baseDir, PROJECT, 'exports/builds/wf.md'), 'utf8');
    expect(wfMd).toContain('Do the thing with {{var}}');
    const wfJson = await readJson('exports/builds/wf.json');
    expect(wfJson.metadata.kind).toBe('build');
  });

  it('multi-version: latest wins metadata and version list is semver-sorted', async () => {
    await writePrompt('prompts/p_v1.json', promptFile('p', { version: '1.0.0' as never, metadata: { status: 'draft' } }));
    const v2 = promptFile('p', { metadata: { status: 'published', domain: 'docs' } });
    (v2 as { version: string }).version = '2.0.0';
    await writePrompt('prompts/p_v2.json', v2);

    const res = await reindexPrompts({ baseDir, project: PROJECT, projectRoot: root });
    expect(res.errors).toEqual([]);

    const catalog = await readJson('exports/catalog/prompts.catalog.json');
    expect(catalog.items.p.versions).toEqual(['1.0.0', '2.0.0']);
    expect(catalog.items.p.latest).toBe('2.0.0');
    expect(catalog.items.p.status).toBe('published');
    expect(catalog.items.p.domain).toBe('docs');
  });

  it('invalid files are collected as errors in index, not thrown', async () => {
    await writePrompt('prompts/good.json', promptFile('good'));
    const bad = path.join(baseDir, PROJECT, 'prompts/broken.json');
    await fs.mkdir(path.dirname(bad), { recursive: true });
    await fs.writeFile(bad, '{ not json', 'utf8');

    const res = await reindexPrompts({ baseDir, project: PROJECT, projectRoot: root });
    expect(res.errors).toEqual([]);
    expect(res.indexed).toBe(2);

    const index = await readJson('index.json');
    const broken = index.items.broken;
    expect(broken.files[0].errors.length).toBeGreaterThan(0);
  });

  it('nested subdirectories under source dirs are scanned', async () => {
    await writePrompt('prompts/deep/nested/inner.json', promptFile('inner'));
    const res = await reindexPrompts({ baseDir, project: PROJECT, projectRoot: root });
    expect(res.indexed).toBe(1);
  });

  it('empty tree still produces catalog with zero items', async () => {
    const res = await reindexPrompts({ baseDir, project: PROJECT, projectRoot: root });
    expect(res.errors).toEqual([]);
    const catalog = await readJson('exports/catalog/prompts.catalog.json');
    expect(catalog.items).toEqual({});
  });
});
