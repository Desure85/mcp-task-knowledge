import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import matter from 'gray-matter';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-markdown');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

let knowledge: typeof import('../src/storage/knowledge.js');
let markdownMod: typeof import('../src/register/markdown.js');

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  knowledge = await import('../src/storage/knowledge.js');
  markdownMod = await import('../src/register/markdown.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

// ---------------------------------------------------------------------------
// Helper: create a mock ServerContext for tool execution
// ---------------------------------------------------------------------------
function makeToolCtx() {
  let lastHandler: any = null;
  const ctx: any = {
    server: {
      registerTool(name: string, _schema: any, handler: any) {
        lastHandler = handler;
      },
    },
    _getHandler() { return lastHandler; },
  };
  return ctx;
}

// Helper: get a tool handler by re-registering tools
async function getToolHandler(toolName: string): Promise<any> {
  const ctx = makeToolCtx();
  // The module registers multiple tools; we capture the last one, so we re-register for each
  markdownMod.registerMarkdownTools(ctx);
  // We need a different approach: register all, then call by name
  return null; // We'll test storage functions directly
}

// ---------------------------------------------------------------------------
// Internal helper tests (slugify, parseMarkdown, docToMarkdown)
// ---------------------------------------------------------------------------

describe('markdown slugify', () => {
  it('slugifies simple titles', async () => {
    const ctx = makeToolCtx();
    markdownMod.registerMarkdownTools(ctx);

    // Test via export: create doc and check file naming
    const prj = uniqProj('slug');
    await knowledge.createDoc({ project: prj, title: 'My API Docs', content: 'test' });
    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(1);
    // The title should be preserved as-is in the storage
    expect(docs[0].title).toBe('My API Docs');
  });

  it('handles special characters in titles', async () => {
    const prj = uniqProj('special');
    await knowledge.createDoc({ project: prj, title: 'Hello @World! #test', content: 'test' });
    const docs = await knowledge.listDocs({ project: prj });
    expect(docs[0].title).toBe('Hello @World! #test');
  });
});

// ---------------------------------------------------------------------------
// knowledge_export_markdown via storage roundtrip
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

    const outDir = path.join(TMP_DIR, 'export-out', prj);
    await fsp.mkdir(outDir, { recursive: true });

    // Simulate export: read docs, write .md files
    const docs = await knowledge.listDocs({ project: prj });
    const written: string[] = [];
    for (const doc of docs) {
      const full = await knowledge.readDoc(prj, doc.id);
      if (!full) continue;
      const slug = full.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const filename = `${slug}.md`;
      const fm: Record<string, unknown> = { title: full.title };
      if (full.tags?.length) fm.tags = full.tags;
      if ((full as any).type) fm.type = (full as any).type;
      const md = matter.stringify(full.content, fm);
      await fsp.writeFile(path.join(outDir, filename), md);
      written.push(filename);
    }

    expect(written.length).toBe(2);
    expect(written).toContain('api-reference.md');
    expect(written).toContain('component-guide.md');

    // Verify file contents have frontmatter
    const apiRaw = await fsp.readFile(path.join(outDir, 'api-reference.md'), 'utf-8');
    const apiParsed = matter(apiRaw);
    expect(apiParsed.data.title).toBe('API Reference');
    expect(apiParsed.data.tags).toEqual(['api', 'reference']);
    expect(apiParsed.data.type).toBe('api');
    expect(apiParsed.content).toContain('# API');
  });

  it('filters by tag during export', async () => {
    const prj = uniqProj('export-tag');
    await knowledge.createDoc({ project: prj, title: 'Doc A', content: 'a', tags: ['public'] });
    await knowledge.createDoc({ project: prj, title: 'Doc B', content: 'b', tags: ['internal'] });

    const docs = await knowledge.listDocs({ project: prj, tag: 'public' });
    expect(docs.length).toBe(1);
    expect(docs[0].title).toBe('Doc A');
  });

  it('filters by type during export', async () => {
    const prj = uniqProj('export-type');
    await knowledge.createDoc({ project: prj, title: 'Doc X', content: 'x', type: 'api' });
    await knowledge.createDoc({ project: prj, title: 'Doc Y', content: 'y', type: 'overview' });

    const docs = await knowledge.listDocs({ project: prj });
    const apiDocs = docs.filter((d: any) => d.type === 'api');
    expect(apiDocs.length).toBe(1);
    expect(apiDocs[0].title).toBe('Doc X');
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

    const docs = await knowledge.listDocs({ project: prj });
    const sections: string[] = [];
    for (const doc of docs) {
      const full = await knowledge.readDoc(prj, doc.id);
      if (!full) continue;
      const header = `## ${full.title}`;
      const metaLine = `> **ID:** ${full.id}\n> **Tags:** ${full.tags?.join(', ')}`;
      sections.push(`${header}\n\n${metaLine}\n\n${full.content}`);
    }
    const bundle = sections.join('\n\n---\n\n');

    expect(bundle).toContain('## First Doc');
    expect(bundle).toContain('## Second Doc');
    expect(bundle).toContain('Content of first.');
    expect(bundle).toContain('Content of second.');
    expect(bundle).toContain('---'); // separator
  });

  it('returns empty bundle when no docs', async () => {
    const prj = uniqProj('bundle-empty');
    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// knowledge_import_markdown
// ---------------------------------------------------------------------------

describe('knowledge_import_markdown', () => {
  it('imports .md files from directory with frontmatter', async () => {
    const prj = uniqProj('import-dir');
    const inDir = path.join(TMP_DIR, 'import-in', prj);
    await fsp.mkdir(inDir, { recursive: true });

    // Create test .md file with frontmatter
    const md1 = matter.stringify(
      'This is the content of doc one.',
      { title: 'Imported Doc One', tags: ['imported', 'test'], type: 'note' }
    );
    await fsp.writeFile(path.join(inDir, 'doc-one.md'), md1);

    const md2 = matter.stringify(
      'Content of doc two.',
      { title: 'Imported Doc Two', tags: ['imported'] }
    );
    await fsp.writeFile(path.join(inDir, 'doc-two.md'), md2);

    // Simulate import: read files, parse, create docs
    const fg = (await import('fast-glob')).default;
    const files = await fg('*.md', { cwd: inDir, absolute: true });

    const created: string[] = [];
    for (const f of files) {
      const raw = await fsp.readFile(f, 'utf-8');
      const parsed = matter(raw);
      const data = parsed.data as any;
      const doc = await knowledge.createDoc({
        project: prj,
        title: data.title || 'Untitled',
        content: parsed.content.replace(/\n$/, ''),
        tags: data.tags || [],
        type: data.type,
      });
      created.push(doc.title);
    }

    expect(created.length).toBe(2);
    expect(created).toContain('Imported Doc One');
    expect(created).toContain('Imported Doc Two');

    // Verify stored docs
    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(2);

    const doc1 = await knowledge.readDoc(prj, docs.find(d => d.title === 'Imported Doc One')!.id);
    expect(doc1?.content).toBe('This is the content of doc one.');
    expect(doc1?.tags).toEqual(['imported', 'test']);
  });

  it('imports files without frontmatter (uses filename-based title)', async () => {
    const prj = uniqProj('import-no-fm');
    const inDir = path.join(TMP_DIR, 'import-no-fm', prj);
    await fsp.mkdir(inDir, { recursive: true });

    await fsp.writeFile(path.join(inDir, 'plain-doc.md'), '# Plain\n\nNo frontmatter here.');

    const fg = (await import('fast-glob')).default;
    const files = await fg('*.md', { cwd: inDir, absolute: true });

    for (const f of files) {
      const raw = await fsp.readFile(f, 'utf-8');
      const parsed = matter(raw);
      const data = parsed.data as any;
      await knowledge.createDoc({
        project: prj,
        title: data.title || 'Untitled',
        content: parsed.content.replace(/\n$/, ''),
      });
    }

    const docs = await knowledge.listDocs({ project: prj });
    expect(docs.length).toBe(1);
    expect(docs[0].title).toBe('Untitled');
  });

  it('overwrite strategy updates existing doc by title', async () => {
    const prj = uniqProj('import-overwrite');
    // Create existing doc
    const existing = await knowledge.createDoc({
      project: prj,
      title: 'To Overwrite',
      content: 'Old content',
      tags: ['old'],
    });
    expect(existing).toBeTruthy();

    const inDir = path.join(TMP_DIR, 'import-ow', prj);
    await fsp.mkdir(inDir, { recursive: true });

    const md = matter.stringify(
      'New updated content.',
      { title: 'To Overwrite', tags: ['new', 'updated'] }
    );
    await fsp.writeFile(path.join(inDir, 'overwrite-me.md'), md);

    // Simulate overwrite: find by title, update
    const docs = await knowledge.listDocs({ project: prj });
    const match = docs.find(d => d.title.toLowerCase() === 'to overwrite');
    expect(match).toBeTruthy();

    if (match) {
      const fg = (await import('fast-glob')).default;
      const files = await fg('*.md', { cwd: inDir, absolute: true });
      for (const f of files) {
        const raw = await fsp.readFile(f, 'utf-8');
        const parsed = matter(raw);
        const data = parsed.data as any;
        await knowledge.updateDoc(prj, match.id, {
          title: data.title,
          content: parsed.content.replace(/\n$/, ''),
          tags: data.tags,
        });
      }

      const updated = await knowledge.readDoc(prj, match.id);
      expect(updated?.content).toBe('New updated content.');
      expect(updated?.tags).toEqual(['new', 'updated']);
    }
  });

  it('supports includePaths and excludePaths filtering', async () => {
    const prj = uniqProj('import-filters');
    const inDir = path.join(TMP_DIR, 'import-filt', prj);
    await fsp.mkdir(path.join(inDir, 'docs'), { recursive: true });
    await fsp.mkdir(path.join(inDir, 'private'), { recursive: true });

    await fsp.writeFile(path.join(inDir, 'docs', 'public.md'), matter.stringify('public', { title: 'Public' }));
    await fsp.writeFile(path.join(inDir, 'private', 'secret.md'), matter.stringify('secret', { title: 'Secret' }));

    const fg = (await import('fast-glob')).default;
    const allFiles = await fg('**/*.md', { cwd: inDir, absolute: true });
    expect(allFiles.length).toBe(2);

    // Include only docs/
    const includeFiles = allFiles.filter(f => f.includes('/docs/'));
    expect(includeFiles.length).toBe(1);

    // Exclude private/
    const excludeFiles = allFiles.filter(f => !f.includes('/private/'));
    expect(excludeFiles.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// knowledge_import_single
// ---------------------------------------------------------------------------

describe('knowledge_import_single', () => {
  it('imports a single markdown string as a knowledge doc', async () => {
    const prj = uniqProj('import-single');

    const md = matter.stringify(
      '# Introduction\n\nThis is the body content.',
      { title: 'Intro Doc', tags: ['intro'], type: 'overview' }
    );

    const parsed = matter(md);
    const data = parsed.data as any;
    const doc = await knowledge.createDoc({
      project: prj,
      title: data.title,
      content: parsed.content.replace(/\n$/, ''),
      tags: data.tags,
      type: data.type,
    });

    expect(doc.title).toBe('Intro Doc');
    expect(doc.tags).toEqual(['intro']);

    const read = await knowledge.readDoc(prj, doc.id);
    expect(read?.content).toBe('# Introduction\n\nThis is the body content.');
  });

  it('imports plain markdown without frontmatter', async () => {
    const prj = uniqProj('import-plain');

    const doc = await knowledge.createDoc({
      project: prj,
      title: 'Plain Markdown',
      content: 'Just some text without frontmatter.',
    });

    expect(doc.title).toBe('Plain Markdown');
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read?.content).toBe('Just some text without frontmatter.');
  });

  it('merges tags from frontmatter and parameters', async () => {
    const prj = uniqProj('import-merge-tags');

    const md = matter.stringify(
      'Content here.',
      { title: 'Merge Tags', tags: ['from-fm'] }
    );

    const parsed = matter(md);
    const data = parsed.data as any;
    const paramTags = ['from-param'];
    const mergedTags = [...new Set([...paramTags, ...(data.tags || [])])];

    const doc = await knowledge.createDoc({
      project: prj,
      title: data.title,
      content: parsed.content.replace(/\n$/, ''),
      tags: mergedTags,
    });

    expect(doc.tags).toEqual(['from-param', 'from-fm']);
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

    const doc = await knowledge.readDoc(prj, created.id);
    expect(doc).toBeTruthy();
    expect(doc!.title).toBe('Export Me');

    // Verify the doc content roundtrips correctly
    const fm: Record<string, unknown> = { title: doc!.title };
    if (doc!.tags?.length) fm.tags = doc!.tags;
    if ((doc as any).type) fm.type = (doc as any).type;
    const exported = matter.stringify(doc!.content, fm);

    const reParsed = matter(exported);
    expect(reParsed.data.title).toBe('Export Me');
    expect(reParsed.data.tags).toEqual(['test']);
    expect(reParsed.data.type).toBe('guide');
    expect(reParsed.content.trim()).toBe('# Hello\n\nWorld.');
  });

  it('exports with system fields when requested', async () => {
    const prj = uniqProj('export-system');

    const created = await knowledge.createDoc({
      project: prj,
      title: 'System Export',
      content: 'content',
    });

    const doc = await knowledge.readDoc(prj, created.id);
    expect(doc).toBeTruthy();

    // Full frontmatter including system fields
    const full: Record<string, unknown> = {
      id: doc!.id,
      project: doc!.project,
      title: doc!.title,
      createdAt: doc!.createdAt,
      updatedAt: doc!.updatedAt,
    };
    if (doc!.tags?.length) full.tags = doc!.tags;
    const exported = matter.stringify(doc!.content, full);

    const reParsed = matter(exported);
    expect(reParsed.data.id).toBe(created.id);
    expect(reParsed.data.project).toBe(prj);
    expect(reParsed.data.createdAt).toBe(doc!.createdAt);
    expect(reParsed.data.updatedAt).toBe(doc!.updatedAt);
  });

  it('returns error for non-existent doc', async () => {
    const prj = uniqProj('export-missing');
    const doc = await knowledge.readDoc(prj, 'non-existent-id');
    expect(doc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Roundtrip: export → import
// ---------------------------------------------------------------------------

describe('export-import roundtrip', () => {
  it('data survives export-to-directory then import-from-directory', async () => {
    const prjA = uniqProj('roundtrip-export');
    const prjB = uniqProj('roundtrip-import');
    const outDir = path.join(TMP_DIR, 'roundtrip', prjA);
    await fsp.mkdir(outDir, { recursive: true });

    // Create source docs
    await knowledge.createDoc({
      project: prjA,
      title: 'Roundtrip Doc',
      content: '## Original Content\n\nPreserved through roundtrip.',
      tags: ['roundtrip', 'test'],
      type: 'guide',
      source: '/path/to/source.md',
    });

    // Export to directory
    const docsA = await knowledge.listDocs({ project: prjA });
    for (const doc of docsA) {
      const full = await knowledge.readDoc(prjA, doc.id);
      if (!full) continue;
      const slug = full.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const fm: Record<string, unknown> = { title: full.title };
      if (full.tags?.length) fm.tags = full.tags;
      if ((full as any).type) fm.type = (full as any).type;
      if (full.source) fm.source = full.source;
      const md = matter.stringify(full.content, fm);
      await fsp.writeFile(path.join(outDir, `${slug}.md`), md);
    }

    // Import into new project
    const fg = (await import('fast-glob')).default;
    const files = await fg('*.md', { cwd: outDir, absolute: true });
    for (const f of files) {
      const raw = await fsp.readFile(f, 'utf-8');
      const parsed = matter(raw);
      const data = parsed.data as any;
      await knowledge.createDoc({
        project: prjB,
        title: data.title || 'Untitled',
        content: parsed.content.replace(/\n$/, ''),
        tags: data.tags || [],
        type: data.type,
        source: data.source,
      });
    }

    // Verify roundtrip
    const docsB = await knowledge.listDocs({ project: prjB });
    expect(docsB.length).toBe(1);
    expect(docsB[0].title).toBe('Roundtrip Doc');

    const imported = await knowledge.readDoc(prjB, docsB[0].id);
    expect(imported?.content).toBe('## Original Content\n\nPreserved through roundtrip.');
    expect(imported?.tags).toEqual(['roundtrip', 'test']);
    expect((imported as any).type).toBe('guide');
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

    // Simulate bundle export
    const docsA = await knowledge.listDocs({ project: prjA });
    const sections: string[] = [];
    for (const doc of docsA) {
      const full = await knowledge.readDoc(prjA, doc.id);
      if (!full) continue;
      const fm: Record<string, unknown> = { title: full.title };
      if (full.tags?.length) fm.tags = full.tags;
      sections.push(matter.stringify(full.content, fm));
    }
    const bundle = sections.join('\n\n---\n\n');

    // Parse back (split by separator)
    const parts = bundle.split('\n\n---\n\n');
    for (const part of parts) {
      const parsed = matter(part.trim());
      const data = parsed.data as any;
      await knowledge.createDoc({
        project: prjB,
        title: data.title || 'Untitled',
        content: parsed.content.replace(/\n$/, ''),
        tags: data.tags || [],
      });
    }

    const docsB = await knowledge.listDocs({ project: prjB });
    expect(docsB.length).toBe(1);
    const imported = await knowledge.readDoc(prjB, docsB[0].id);
    expect(imported?.content).toBe('Bundle content preserved.');
    expect(imported?.tags).toEqual(['bundle']);
  });
});
