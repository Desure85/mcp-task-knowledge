import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedPromptsIfEmpty } from '../src/services/prompts-seed.js';
import { reindexPrompts } from '../src/services/prompts-pipeline.js';

let root: string;
let baseDir: string;
const PROJECT = 'testproj';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-test-'));
  baseDir = path.join(root, 'prompts-base');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeUserPrompt(rel: string, id: string) {
  const file = path.join(baseDir, PROJECT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    type: 'prompt',
    id,
    version: '1.0.0',
    metadata: { title: id, domain: 'custom', status: 'draft' },
    template: 'user template',
    variables: [],
  }, null, 2), 'utf8');
}

async function countSourceJsons(): Promise<number> {
  let count = 0;
  for (const dir of ['prompts', 'rules', 'workflows', 'templates', 'policies']) {
    const dirPath = path.join(baseDir, PROJECT, dir);
    try {
      const entries = await fs.readdir(dirPath);
      count += entries.filter((f) => f.endsWith('.json')).length;
    } catch {}
  }
  return count;
}

describe('DX-14: seedPromptsIfEmpty', () => {
  it('seeds 7 workflow prompts into an empty library', async () => {
    const result = await seedPromptsIfEmpty(baseDir, PROJECT);
    expect(result.seeded).toBe(true);
    expect(result.count).toBe(7);
    expect(result.ids).toEqual(
      expect.arrayContaining([
        'plan_sprint', 'capture_decision', 'standup',
        'postmortem', 'daily_review', 'code_review', 'bug_triage',
      ]),
    );
    expect(await countSourceJsons()).toBe(7);
  });

  it('writes valid prompt JSON matching the storage contract', async () => {
    await seedPromptsIfEmpty(baseDir, PROJECT);
    const file = path.join(baseDir, PROJECT, 'prompts', 'plan_sprint@1.0.0.json');
    const raw = await fs.readFile(file, 'utf8');
    const doc = JSON.parse(raw);
    expect(doc.type).toBe('prompt');
    expect(doc.id).toBe('plan_sprint');
    expect(doc.version).toBe('1.0.0');
    expect(doc.metadata.title).toBeTruthy();
    expect(doc.metadata.domain).toBeTruthy();
    expect(doc.metadata.status).toBe('published');
    expect(doc.metadata.tags.length).toBeGreaterThan(0);
    expect(typeof doc.template).toBe('string');
    expect(doc.template.length).toBeGreaterThan(50);
    expect(Array.isArray(doc.variables)).toBe(true);
  });

  it('does NOT seed when library already has prompts', async () => {
    await writeUserPrompt('prompts/my-custom@1.0.0.json', 'my-custom');
    const result = await seedPromptsIfEmpty(baseDir, PROJECT);
    expect(result.seeded).toBe(false);
    expect(result.count).toBe(0);
    expect(result.reason).toBe('library not empty');
    expect(await countSourceJsons()).toBe(1);
  });

  it('does NOT seed when library has prompts in non-prompts kind dirs', async () => {
    await writeUserPrompt('rules/my-rule@1.0.0.json', 'my-rule');
    const result = await seedPromptsIfEmpty(baseDir, PROJECT);
    expect(result.seeded).toBe(false);
    expect(await countSourceJsons()).toBe(1);
  });

  it('does NOT seed when a catalog exists but source dirs are empty', async () => {
    const catalogPath = path.join(baseDir, PROJECT, 'exports', 'catalog', 'prompts.catalog.json');
    await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await fs.writeFile(catalogPath, JSON.stringify({ items: { p1: { id: 'p1' } } }), 'utf8');
    const result = await seedPromptsIfEmpty(baseDir, PROJECT);
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('library not empty');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    expect(catalog.items.p1).toBeTruthy();
    expect(await countSourceJsons()).toBe(0);
  });

  it('is idempotent — second call is a no-op', async () => {
    const first = await seedPromptsIfEmpty(baseDir, PROJECT);
    expect(first.seeded).toBe(true);
    const second = await seedPromptsIfEmpty(baseDir, PROJECT);
    expect(second.seeded).toBe(false);
    expect(await countSourceJsons()).toBe(7);
  });

  it('seeded prompts pass through reindexPrompts and appear in catalog', async () => {
    await seedPromptsIfEmpty(baseDir, PROJECT);
    const result = await reindexPrompts({ baseDir, project: PROJECT, projectRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.indexed).toBe(7);
    expect(result.cataloged).toBe(7);

    const catalogPath = path.join(baseDir, PROJECT, 'exports', 'catalog', 'prompts.catalog.json');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    expect(Object.keys(catalog.items)).toHaveLength(7);
    expect(catalog.items['plan_sprint'].title).toBe('Sprint Planning');
    expect(catalog.items['bug_triage'].domain).toBe('workflow');
    expect(catalog.items['code_review'].tags).toContain('code-review');
  });

  it('each seed has required variables array and non-empty template', async () => {
    await seedPromptsIfEmpty(baseDir, PROJECT);
    for (const id of ['plan_sprint', 'capture_decision', 'standup', 'postmortem', 'daily_review', 'code_review', 'bug_triage']) {
      const file = path.join(baseDir, PROJECT, 'prompts', `${id}@1.0.0.json`);
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(Array.isArray(doc.variables), `${id} missing variables`).toBe(true);
      expect(doc.template.length, `${id} template too short`).toBeGreaterThan(50);
      expect(doc.metadata.status, `${id} bad status`).toBe('published');
    }
  });
});
