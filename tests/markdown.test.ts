/**
 * Markdown import/export tools — tests the REAL registered handlers.
 *
 * History: this file used to hand-roll slugify + gray-matter + fast-glob and
 * assert its own re-implementation (`_getToolHandler` returned null), so the
 * shipped handlers in `src/register/markdown.ts` were never executed
 * (TR-04 audit, MOCK-DRIFT). Every case below calls the handler registered by
 * `registerMarkdownTools` through a capturing mock ServerContext.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import matter from 'gray-matter';

// TMP envs must be set before dynamic imports (config.ts resolves paths on load).
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-markdown');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

let knowledge: typeof import('../src/storage/knowledge.js');
let markdownMod: typeof import('../src/register/markdown.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

let handlers: Map<string, ToolHandler>;

/** Call a tool registered by registerMarkdownTools and unwrap the ok/err envelope. */
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`tool not registered: ${name} (have: ${[...handlers.keys()].join(', ')})`);
  const result = (await handler(args)) as { content?: Array<{ text?: string }>; isError?: boolean };
  const text = result?.content?.[0]?.text;
  return { ...(typeof text === 'string' ? JSON.parse(text) : {}), isError: result?.isError === true };
}

async function rmrf(p: string) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function tmpPath(...parts: string[]) {
  return path.join(TMP_DIR, 'work', crypto.randomUUID().slice(0, 8), ...parts);
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });

  knowledge = await import('../src/storage/knowledge.js');
  markdownMod = await import('../src/register/markdown.js');

  handlers = new Map();
  markdownMod.registerMarkdownTools({
    server: {
      registerTool(name: string, _def: unknown, handler: ToolHandler) {
        handlers.set(name, handler);
      },
    },
  } as never);
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

// ---------------------------------------------------------------------------
// slugify — exercised through knowledge_export_markdown dryRun
// ---------------------------------------------------------------------------

describe('markdown slugify (knowledge_export_markdown dryRun)', () => {
  it('slugifies simple titles and keeps the original title in the report', async () => {
    const prj = uniqProj('slug');
    await knowledge.createDoc({ project: prj, title: 'My API Docs', content: 'test' });

    const res = await call('knowledge_export_markdown', {
      project: prj,
      outputDir: tmpPath('slug-out'),
      dryRun: true,
    });

    expect(res.ok).toBe(true);
    expect(res.data.count).toBe(1);
    expect(res.data.files[0].file).toBe('my-api-docs.md');
    expect(res.data.files[0].title).toBe('My API Docs');
  });

  it('handles special characters in titles', async () => {
    const prj = uniqProj('special');
    await knowledge.createDoc({ project: prj, title: 'Hello @World! #test', content: 'test' });

    const res = await call('knowledge_export_markdown', {
      project: prj,
      outputDir: tmpPath('special-out'),
      dryRun: true,
    });

    expect(res.data.files[0].file).toBe('hello-world-test.md');
    expect(res.data.files[0].title).toBe('Hello @World! #test');
  });
});

// ---------------------------------------------------------------------------
// knowledge_export_markdown
// ---------------------------------------------------------------------------

describe('knowledge_export_markdown', () => {
  it('exports docs to directory as .md files with frontmatter', async () => {
    const prj = uniqProj('export-dir');
    await knowledge.createDoc({
      project: prj,
      title: 'API Reference',
      content: '# API\n\nEndpoints listed here.',
      tags: ['api', 'reference'],
      type: 'api',
    });
    await knowledge.createDoc({
      project: prj,
      title: 'Component Guide',
      content: '## Components\n\nButtons, inputs, etc.',
      tags: ['ui'],
      type: 'component',
    });

    const outDir = tmpPath('export-out');
    const res = await call('knowledge_export_markdown', { project: prj, outputDir: outDir });

    expect(res.ok).toBe(true);
    expect(res.data.exported).toBe(2);
    expect(res.data.files.map((f: { file: string }) => f.file).sort()).toEqual([
      'api-reference.md',
      'component-guide.md',
    ]);

    const apiParsed = matter(await fsp.readFile(path.join(outDir, 'api-reference.md'), 'utf-8'));
    expect(apiParsed.data.title).toBe('API Reference');
    expect(apiParsed.data.tags).toEqual(['api', 'reference']);
    expect(apiParsed.data.type).toBe('api');
    expect(apiParsed.content).toContain('# API');

    const componentParsed = matter(await fsp.readFile(path.join(outDir, 'component-guide.md'), 'utf-8'));
    expect(componentParsed.data.type).toBe('component');
  });

  it('filters by tag during export', async () => {
    const prj = uniqProj('export-tag');
    await knowledge.createDoc({ project: prj, title: 'Doc A', content: 'a', tags: ['public'] });
    await knowledge.createDoc({ project: prj, title: 'Doc B', content: 'b', tags: ['internal'] });

    const outDir = tmpPath('export-tag-out');
    const res = await call('knowledge_export_markdown', { project: prj, outputDir: outDir, tag: 'public' });

    expect(res.data.exported).toBe(1);
    expect(res.data.files[0].title).toBe('Doc A');
    const files = await fsp.readdir(outDir);
    expect(files).toEqual(['doc-a.md']);
  });

  it('filters by type during export', async () => {
    const prj = uniqProj('export-type');
    await knowledge.createDoc({ project: prj, title: 'Doc X', content: 'x', type: 'api' });
    await knowledge.createDoc({ project: prj, title: 'Doc Y', content: 'y', type: 'overview' });

    const res = await call('knowledge_export_markdown', {
      project: prj,
      outputDir: tmpPath('export-type-out'),
      type: 'api',
    });

    expect(res.data.exported).toBe(1);
    expect(res.data.files[0].title).toBe('Doc X');
  });

  it('rejects a relative outputDir', async () => {
    const prj = uniqProj('export-relative');

    const res = await call('knowledge_export_markdown', { project: prj, outputDir: 'relative/dir' });

    expect(res.ok).toBe(false);
    expect(res.isError).toBe(true);
    expect(res.error.message).toBe('outputDir must be an absolute path');
  });
});

// ---------------------------------------------------------------------------
// knowledge_export_bundle
// ---------------------------------------------------------------------------

describe('knowledge_export_bundle', () => {
  it('concatenates docs into single markdown string', async () => {
    const prj = uniqProj('bundle');
    await knowledge.createDoc({
      project: prj,
      title: 'First Doc',
      content: 'Content of first.',
      tags: ['a'],
    });
    await knowledge.createDoc({
      project: prj,
      title: 'Second Doc',
      content: 'Content of second.',
      tags: ['b'],
    });

    const res = await call('knowledge_export_bundle', { project: prj });

    expect(res.ok).toBe(true);
    expect(res.data.count).toBe(2);
    expect(res.data.bundle).toContain('## First Doc');
    expect(res.data.bundle).toContain('## Second Doc');
    expect(res.data.bundle).toContain('Content of first.');
    expect(res.data.bundle).toContain('Content of second.');
    expect(res.data.bundle).toContain('> **Tags:** a');
    expect(res.data.bundle).toContain('\n\n---\n\n');
    expect(res.data.chars).toBe(res.data.bundle.length);
  });

  it('returns empty bundle when no docs', async () => {
    const prj = uniqProj('bundle-empty');

    const res = await call('knowledge_export_bundle', { project: prj });

    expect(res.ok).toBe(true);
    expect(res.data.count).toBe(0);
    expect(res.data.bundle).toBe('');
  });

  it('honours headingLevel and includeFrontmatter=false', async () => {
    const prj = uniqProj('bundle-options');
    await knowledge.createDoc({ project: prj, title: 'Solo', content: 'Body.', tags: ['t'] });

    const res = await call('knowledge_export_bundle', {
      project: prj,
      headingLevel: 3,
      includeFrontmatter: false,
    });

    expect(res.data.bundle).toContain('### Solo');
    expect(res.data.bundle).toContain('> **Tags:** t');
    expect(res.data.bundle).not.toContain('title: Solo');
    expect(res.data.bundle.trimEnd().endsWith('Body.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// knowledge_import_markdown
// ---------------------------------------------------------------------------

describe('knowledge_import_markdown', () => {
  it('imports .md files from directory with frontmatter', async () => {
    const prj = uniqProj('import-dir');
    const inDir = tmpPath('import-in');
    await fsp.mkdir(inDir, { recursive: true });

    await fsp.writeFile(
      path.join(inDir, 'doc-one.md'),
      matter.stringify('This is the content of doc one.', {
        title: 'Imported Doc One',
        tags: ['imported', 'test'],
        type: 'note',
      }),
    );
    await fsp.writeFile(
      path.join(inDir, 'doc-two.md'),
      matter.stringify('Content of doc two.', { title: 'Imported Doc Two', tags: ['imported'] }),
    );

    const res = await call('knowledge_import_markdown', { project: prj, inputDir: inDir });

    expect(res.ok).toBe(true);
    expect(res.data.strategy).toBe('overwrite');
    expect(res.data.created).toBe(2);
    expect(res.data.updated).toBe(0);
    expect(res.data.results.map((r: { title: string }) => r.title).sort()).toEqual([
      'Imported Doc One',
      'Imported Doc Two',
    ]);

    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(2);
    const doc1 = await knowledge.readDoc(prj, docs.find((d) => d.title === 'Imported Doc One')!.id);
    expect(doc1?.content).toBe('This is the content of doc one.');
    expect(doc1?.tags).toEqual(['imported', 'test']);
    expect((doc1 as { type?: string } | null)?.type).toBe('note');
  });

  it('imports files without frontmatter as Untitled', async () => {
    const prj = uniqProj('import-no-fm');
    const inDir = tmpPath('import-no-fm');
    await fsp.mkdir(inDir, { recursive: true });
    await fsp.writeFile(path.join(inDir, 'plain-doc.md'), '# Plain\n\nNo frontmatter here.');

    const res = await call('knowledge_import_markdown', { project: prj, inputDir: inDir });

    expect(res.data.created).toBe(1);
    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(1);
    // The handler falls back to "Untitled" — it does not derive a title from the filename.
    expect(docs[0].title).toBe('Untitled');
  });

  it('overwrite strategy updates existing doc by title', async () => {
    const prj = uniqProj('import-overwrite');
    const existing = await knowledge.createDoc({
      project: prj,
      title: 'To Overwrite',
      content: 'Old content',
      tags: ['old'],
    });
    expect(existing).toBeTruthy();

    const inDir = tmpPath('import-ow');
    await fsp.mkdir(inDir, { recursive: true });
    await fsp.writeFile(
      path.join(inDir, 'overwrite-me.md'),
      matter.stringify('New updated content.', { title: 'To Overwrite', tags: ['new', 'updated'] }),
    );

    const res = await call('knowledge_import_markdown', {
      project: prj,
      inputDir: inDir,
      strategy: 'overwrite',
    });

    expect(res.data.created).toBe(0);
    expect(res.data.updated).toBe(1);
    expect(res.data.results[0]).toMatchObject({ action: 'update', id: existing.id });

    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(1);
    const updated = await knowledge.readDoc(prj, existing.id);
    expect(updated?.content).toBe('New updated content.');
    expect(updated?.tags).toEqual(['new', 'updated']);
  });

  it('skip strategy leaves an existing doc untouched', async () => {
    const prj = uniqProj('import-skip');
    const existing = await knowledge.createDoc({
      project: prj,
      title: 'Keep Me',
      content: 'original',
      tags: ['original'],
    });

    const inDir = tmpPath('import-skip');
    await fsp.mkdir(inDir, { recursive: true });
    await fsp.writeFile(
      path.join(inDir, 'keep-me.md'),
      matter.stringify('changed', { title: 'Keep Me', tags: ['changed'] }),
    );

    const res = await call('knowledge_import_markdown', {
      project: prj,
      inputDir: inDir,
      strategy: 'skip',
    });

    expect(res.data.skipped).toBe(1);
    expect(res.data.created).toBe(0);
    expect(res.data.updated).toBe(0);

    const unchanged = await knowledge.readDoc(prj, existing.id);
    expect(unchanged?.content).toBe('original');
    expect(unchanged?.tags).toEqual(['original']);
  });

  it('supports includePaths and excludePaths filtering', async () => {
    const inDir = tmpPath('import-filt');
    await fsp.mkdir(path.join(inDir, 'docs'), { recursive: true });
    await fsp.mkdir(path.join(inDir, 'private'), { recursive: true });
    await fsp.writeFile(
      path.join(inDir, 'docs', 'public.md'),
      matter.stringify('public', { title: 'Public' }),
    );
    await fsp.writeFile(
      path.join(inDir, 'private', 'secret.md'),
      matter.stringify('secret', { title: 'Secret' }),
    );

    const prjInclude = uniqProj('import-include');
    const includeRes = await call('knowledge_import_markdown', {
      project: prjInclude,
      inputDir: inDir,
      includePaths: ['docs'],
    });
    expect(includeRes.data.created).toBe(1);
    expect(includeRes.data.results[0].title).toBe('Public');

    const prjExclude = uniqProj('import-exclude');
    const excludeRes = await call('knowledge_import_markdown', {
      project: prjExclude,
      inputDir: inDir,
      excludePaths: ['private'],
    });
    expect(excludeRes.data.created).toBe(1);
    expect(excludeRes.data.results[0].title).toBe('Public');
  });

  it('rejects a relative inputDir', async () => {
    const res = await call('knowledge_import_markdown', {
      project: uniqProj('import-relative'),
      inputDir: 'relative/dir',
    });

    expect(res.ok).toBe(false);
    expect(res.error.message).toBe('inputDir must be an absolute path');
  });

  it('rejects a missing inputDir', async () => {
    const missing = tmpPath('does-not-exist');
    const res = await call('knowledge_import_markdown', {
      project: uniqProj('import-missing'),
      inputDir: missing,
    });

    expect(res.ok).toBe(false);
    expect(res.error.message).toBe(`inputDir does not exist: ${missing}`);
  });
});

// ---------------------------------------------------------------------------
// knowledge_import_single
// ---------------------------------------------------------------------------

describe('knowledge_import_single', () => {
  it('imports a single markdown string as a knowledge doc', async () => {
    const prj = uniqProj('import-single');
    const md = matter.stringify('# Introduction\n\nThis is the body content.', {
      title: 'Intro Doc',
      tags: ['intro'],
      type: 'overview',
    });

    const res = await call('knowledge_import_single', { project: prj, markdown: md });

    expect(res.ok).toBe(true);
    expect(res.data.title).toBe('Intro Doc');
    expect(res.data.project).toBe(prj);
    expect(res.data.trustLevel).toBe('user');

    const read = await knowledge.readDoc(prj, res.data.id);
    expect(read?.content).toBe('# Introduction\n\nThis is the body content.');
    expect(read?.tags).toEqual(['intro']);
    expect((read as { type?: string } | null)?.type).toBe('overview');
  });

  it('imports plain markdown without frontmatter', async () => {
    const prj = uniqProj('import-plain');

    const res = await call('knowledge_import_single', {
      project: prj,
      title: 'Plain Markdown',
      markdown: 'Just some text without frontmatter.',
    });

    expect(res.data.title).toBe('Plain Markdown');
    const read = await knowledge.readDoc(prj, res.data.id);
    expect(read?.content).toBe('Just some text without frontmatter.');
  });

  it('merges tags from frontmatter and parameters', async () => {
    const prj = uniqProj('import-merge-tags');
    const md = matter.stringify('Content here.', { title: 'Merge Tags', tags: ['from-fm'] });

    const res = await call('knowledge_import_single', {
      project: prj,
      markdown: md,
      tags: ['from-param'],
    });

    const read = await knowledge.readDoc(prj, res.data.id);
    expect(read?.tags).toEqual(['from-param', 'from-fm']);
  });

  it('honours an explicit trustLevel over frontmatter', async () => {
    const prj = uniqProj('import-trust');
    const md = matter.stringify('External content.', {
      title: 'Trusted Doc',
      trustLevel: 'user',
    });

    const res = await call('knowledge_import_single', {
      project: prj,
      markdown: md,
      trustLevel: 'external',
    });

    expect(res.data.trustLevel).toBe('external');
  });
});

// ---------------------------------------------------------------------------
// knowledge_export_single
// ---------------------------------------------------------------------------

describe('knowledge_export_single', () => {
  it('exports a single doc with user-friendly frontmatter', async () => {
    const prj = uniqProj('export-single');
    const created = await knowledge.createDoc({
      project: prj,
      title: 'Export Me',
      content: '# Hello\n\nWorld.',
      tags: ['test'],
      type: 'guide',
    });

    const res = await call('knowledge_export_single', { project: prj, id: created.id });

    expect(res.ok).toBe(true);
    expect(res.data.title).toBe('Export Me');

    const reParsed = matter(res.data.markdown);
    expect(reParsed.data.title).toBe('Export Me');
    expect(reParsed.data.tags).toEqual(['test']);
    expect(reParsed.data.type).toBe('guide');
    expect(reParsed.data.id).toBeUndefined();
    expect(reParsed.data.createdAt).toBeUndefined();
    expect(reParsed.content.trim()).toBe('# Hello\n\nWorld.');
  });

  it('exports with system fields when requested', async () => {
    const prj = uniqProj('export-system');
    const created = await knowledge.createDoc({
      project: prj,
      title: 'System Export',
      content: 'content',
    });

    const res = await call('knowledge_export_single', {
      project: prj,
      id: created.id,
      includeSystemFields: true,
    });

    const reParsed = matter(res.data.markdown);
    expect(reParsed.data.id).toBe(created.id);
    expect(reParsed.data.project).toBe(prj);
    expect(reParsed.data.createdAt).toBe(created.createdAt);
    expect(reParsed.data.updatedAt).toBe(created.updatedAt);
  });

  it('returns error for non-existent doc', async () => {
    const prj = uniqProj('export-missing');

    const res = await call('knowledge_export_single', { project: prj, id: 'non-existent-id' });

    expect(res.ok).toBe(false);
    expect(res.isError).toBe(true);
    expect(res.error.message).toBe(`Knowledge doc not found: ${prj}/non-existent-id`);
  });
});

// ---------------------------------------------------------------------------
// Roundtrip: export → import
// ---------------------------------------------------------------------------

describe('export-import roundtrip', () => {
  it('data survives export-to-directory then import-from-directory', async () => {
    const prjA = uniqProj('roundtrip-export');
    const prjB = uniqProj('roundtrip-import');
    const outDir = tmpPath('roundtrip');

    await knowledge.createDoc({
      project: prjA,
      title: 'Roundtrip Doc',
      content: '## Original Content\n\nPreserved through roundtrip.',
      tags: ['roundtrip', 'test'],
      type: 'guide',
      source: '/path/to/source.md',
    });

    const exportRes = await call('knowledge_export_markdown', { project: prjA, outputDir: outDir });
    expect(exportRes.data.exported).toBe(1);

    const importRes = await call('knowledge_import_markdown', { project: prjB, inputDir: outDir });
    expect(importRes.data.created).toBe(1);

    const docsB = await knowledge.listDocs({ project: prjB });
    expect(docsB.length).toBe(1);
    expect(docsB[0].title).toBe('Roundtrip Doc');

    const imported = await knowledge.readDoc(prjB, docsB[0].id);
    expect(imported?.content).toBe('## Original Content\n\nPreserved through roundtrip.');
    expect(imported?.tags).toEqual(['roundtrip', 'test']);
    expect((imported as { type?: string } | null)?.type).toBe('guide');
    expect(imported?.source).toBe('/path/to/source.md');
  });

  it('bundle export → single import preserves content', async () => {
    const prjA = uniqProj('bundle-export');
    const prjB = uniqProj('bundle-import');

    await knowledge.createDoc({
      project: prjA,
      title: 'Bundle Doc',
      content: 'Bundle content preserved.',
      tags: ['bundle'],
    });

    const bundleRes = await call('knowledge_export_bundle', { project: prjA });
    expect(bundleRes.data.count).toBe(1);

    const parts = String(bundleRes.data.bundle).split('\n\n---\n\n');
    expect(parts).toHaveLength(1);

    const importRes = await call('knowledge_import_single', {
      project: prjB,
      markdown: parts[0],
    });
    expect(importRes.ok).toBe(true);

    const docsB = await knowledge.listDocs({ project: prjB });
    expect(docsB.length).toBe(1);

    const imported = await knowledge.readDoc(prjB, docsB[0].id);
    // The bundle puts its own heading/meta block before the doc frontmatter, so
    // only the body is a re-importable contract here — the content must survive.
    expect(imported?.content).toContain('Bundle content preserved.');
    expect(imported?.content).toContain('## Bundle Doc');
  });
});
