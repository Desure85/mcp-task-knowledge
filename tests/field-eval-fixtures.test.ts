import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertLanguages, buildFixtures, loadCatalogs } from '../scripts/build-field-eval-fixtures.mjs';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeCatalogs() {
  const dir = await mkdtemp(join(tmpdir(), 'field-eval-'));
  dirs.push(dir);
  const messages = join(dir, 'src', 'i18n', 'messages');
  await mkdir(messages, { recursive: true });
  await writeFile(join(messages, 'en.json'), JSON.stringify({ pipeline: { name: 'Pipeline', run: 'Run' }, task: { title: 'Title' } }));
  await writeFile(join(messages, 'ru.json'), JSON.stringify({ pipeline: { name: 'Pipeline RU', run: 'Run RU' }, task: { title: 'Title RU' } }));
  await writeFile(join(messages, 'de.json'), JSON.stringify({ pipeline: { name: 'Pipeline DE', run: 'Run DE' }, task: { title: 'Title DE' } }));
  return { dir, messages };
}

describe('KE-06 field-eval fixture builder', () => {
  it('flattens JSON catalogs and builds deterministic gold/labels', async () => {
    const { messages } = await makeCatalogs();
    const { langs, gold, labels } = buildFixtures(loadCatalogs(messages));
    expect(langs).toEqual(['de', 'en', 'ru']);
    expect(gold.map((field) => field.name)).toEqual(['pipeline.name', 'pipeline.run', 'task.title']);
    expect(gold[0]).toMatchObject({ group: 'pipeline', type: 'ui-string', desc: 'Pipeline' });
    expect(labels[0]).toMatchObject({ group: 'pipeline', en: 'Pipeline', ru: 'Pipeline RU', de: 'Pipeline DE' });
  });

  it('accepts any language set and enforces only explicit requirements', async () => {
    const { messages } = await makeCatalogs();
    const { langs } = buildFixtures(loadCatalogs(messages));
    expect(assertLanguages(langs, [])).toEqual([]);
    expect(assertLanguages(langs, ['en', 'ru'])).toEqual([]);
    expect(() => assertLanguages(langs, ['tr'])).toThrow(/missing required languages/);
  });

  it('fails on missing directory or too few catalogs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'field-eval-empty-'));
    dirs.push(dir);
    expect(() => loadCatalogs(join(dir, 'nope'))).toThrow(/not found/);
    await mkdir(join(dir, 'one'), { recursive: true });
    await writeFile(join(dir, 'one', 'en.json'), '{}');
    expect(() => loadCatalogs(join(dir, 'one'))).toThrow(/at least 2 language catalogs/);
  });
});
