import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import matter from 'gray-matter';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-unit');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

import type * as KnowledgeNS from '../src/storage/knowledge.js';
let knowledge: typeof KnowledgeNS;

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  knowledge = await import('../src/storage/knowledge.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

// ---------------------------------------------------------------------------
// createDoc
// ---------------------------------------------------------------------------
describe('knowledge: createDoc', () => {
  it('creates doc with all fields', async () => {
    const prj = uniqProj('create');
    const doc = await knowledge.createDoc({
      project: prj,
      title: 'Full Doc',
      content: '# Hello\n\nBody text.',
      tags: ['api', 'reference'],
      type: 'guide',
      source: '/path/to/source.md',
      parentId: undefined,
    });
    expect(doc.id).toBeTruthy();
    expect(doc.project).toBe(prj);
    expect(doc.title).toBe('Full Doc');
    expect(doc.content).toBe('# Hello\n\nBody text.');
    expect(doc.tags).toEqual(['api', 'reference']);
    expect((doc as any).type).toBe('guide');
    expect(doc.source).toBe('/path/to/source.md');
    expect(doc.archived).toBe(false);
    expect(doc.trashed).toBe(false);
    expect(doc.createdAt).toBeTruthy();
    expect(doc.updatedAt).toBeTruthy();
  });

  it('creates doc with minimal fields', async () => {
    const prj = uniqProj('create-min');
    const doc = await knowledge.createDoc({ project: prj, title: 'Minimal', content: 'text' });
    expect(doc.tags).toEqual([]);
    expect(doc.source).toBeUndefined();
    expect((doc as any).type).toBeUndefined();
    expect(doc.parentId).toBeUndefined();
  });

  it('assigns unique IDs', async () => {
    const prj = uniqProj('create-ids');
    const d1 = await knowledge.createDoc({ project: prj, title: 'D1', content: 'a' });
    const d2 = await knowledge.createDoc({ project: prj, title: 'D2', content: 'b' });
    expect(d1.id).not.toBe(d2.id);
  });

  it('writes file with frontmatter', async () => {
    const prj = uniqProj('create-fm');
    const doc = await knowledge.createDoc({ project: prj, title: 'FM Test', content: 'body', tags: ['test'] });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read).toBeTruthy();
    // Verify file on disk has valid frontmatter
    const raw = await fsp.readFile(
      path.join(process.env.DATA_DIR!, 'knowledge', prj, `${doc.id}.md`), 'utf-8'
    );
    const parsed = matter(raw);
    expect(parsed.data.title).toBe('FM Test');
    expect(parsed.data.tags).toEqual(['test']);
    expect(parsed.content.replace(/\n$/, '')).toBe('body');
  });
});

// ---------------------------------------------------------------------------
// readDoc
// ---------------------------------------------------------------------------
describe('knowledge: readDoc', () => {
  it('returns full doc by id', async () => {
    const prj = uniqProj('read');
    const created = await knowledge.createDoc({ project: prj, title: 'Read Me', content: 'content here' });
    const read = await knowledge.readDoc(prj, created.id);
    expect(read!.id).toBe(created.id);
    expect(read!.title).toBe('Read Me');
    expect(read!.content).toBe('content here');
  });

  it('returns null for non-existent id', async () => {
    const prj = uniqProj('read-missing');
    const read = await knowledge.readDoc(prj, 'non-existent-id');
    expect(read).toBeNull();
  });

  it('normalizes trailing newline in content', async () => {
    const prj = uniqProj('read-newline');
    const doc = await knowledge.createDoc({ project: prj, title: 'NL', content: 'line1\nline2' });
    const read = await knowledge.readDoc(prj, doc.id);
    // gray-matter may add trailing newline; readDoc should strip it
    expect(read!.content).toBe('line1\nline2');
  });

  it('finds doc when project dir exists with the file', async () => {
    const prj = uniqProj('read-found');
    const doc = await knowledge.createDoc({ project: prj, title: 'Found', content: 'found content' });
    // Read using readDoc should work
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read).toBeTruthy();
    expect(read!.content).toBe('found content');
    // Also verify that readDoc returns null for different project
    const wrongProj = uniqProj('read-wrong');
    const wrongRead = await knowledge.readDoc(wrongProj, doc.id);
    expect(wrongRead).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateDoc
// ---------------------------------------------------------------------------
describe('knowledge: updateDoc', () => {
  it('updates title and content', async () => {
    const prj = uniqProj('update');
    const doc = await knowledge.createDoc({ project: prj, title: 'Old', content: 'old content' });
    const updated = await knowledge.updateDoc(prj, doc.id, { title: 'New', content: 'new content' });
    expect(updated!.title).toBe('New');
    expect(updated!.content).toBe('new content');
    expect(updated!.updatedAt).not.toBe(doc.updatedAt);
    // Immutable fields preserved
    expect(updated!.id).toBe(doc.id);
    expect(updated!.project).toBe(doc.project);
    expect(updated!.createdAt).toBe(doc.createdAt);
  });

  it('updates tags (replaces)', async () => {
    const prj = uniqProj('update-tags');
    const doc = await knowledge.createDoc({ project: prj, title: 'T', content: 'c', tags: ['a', 'b'] });
    const updated = await knowledge.updateDoc(prj, doc.id, { tags: ['x'] });
    expect(updated!.tags).toEqual(['x']);
  });

  it('updates type', async () => {
    const prj = uniqProj('update-type');
    const doc = await knowledge.createDoc({ project: prj, title: 'T', content: 'c', type: 'note' });
    const updated = await knowledge.updateDoc(prj, doc.id, { type: 'api' });
    expect((updated as any).type).toBe('api');
  });

  it('updates source', async () => {
    const prj = uniqProj('update-source');
    const doc = await knowledge.createDoc({ project: prj, title: 'T', content: 'c' });
    const updated = await knowledge.updateDoc(prj, doc.id, { source: '/new/path.md' });
    expect(updated!.source).toBe('/new/path.md');
  });

  it('returns null for non-existent doc', async () => {
    const prj = uniqProj('update-missing');
    const result = await knowledge.updateDoc(prj, 'non-existent', { title: 'X' });
    expect(result).toBeNull();
  });

  it('preserves id, project, and createdAt on update', async () => {
    const prj = uniqProj('update-immutable');
    const doc = await knowledge.createDoc({ project: prj, title: 'Immutable', content: 'test content' });
    const before = await knowledge.readDoc(prj, doc.id);
    const updated = await knowledge.updateDoc(prj, doc.id, { title: 'Still Immutable' });
    expect(updated!.id).toBe(doc.id);
    expect(updated!.project).toBe(doc.project);
    expect(updated!.createdAt).toBe(doc.createdAt);
    expect(updated!.title).toBe('Still Immutable');
    // Verify updatedAt changed but createdAt didn't
    expect(updated!.updatedAt).not.toBe(before!.updatedAt);
    expect(updated!.createdAt).toBe(before!.createdAt);
  });

  it('partial update preserves unmodified fields', async () => {
    const prj = uniqProj('update-partial');
    const doc = await knowledge.createDoc({
      project: prj, title: 'Original', content: 'body',
      tags: ['keep'], type: 'note', source: '/src.md',
    });
    const updated = await knowledge.updateDoc(prj, doc.id, { title: 'Changed' });
    expect(updated!.title).toBe('Changed');
    expect(updated!.content).toBe('body');
    expect(updated!.tags).toEqual(['keep']);
    expect((updated as any).type).toBe('note');
    expect(updated!.source).toBe('/src.md');
  });
});

// ---------------------------------------------------------------------------
// listDocs — filters
// ---------------------------------------------------------------------------
describe('knowledge: listDocs filtering', () => {
  it('lists all docs in project', async () => {
    const prj = uniqProj('list-all');
    await knowledge.createDoc({ project: prj, title: 'D1', content: 'a' });
    await knowledge.createDoc({ project: prj, title: 'D2', content: 'b' });
    await knowledge.createDoc({ project: prj, title: 'D3', content: 'c' });

    const list = await knowledge.listDocs({ project: prj });
    expect(list.length).toBe(3);
  });

  it('filters by tag', async () => {
    const prj = uniqProj('list-tag');
    await knowledge.createDoc({ project: prj, title: 'API', content: 'a', tags: ['api'] });
    await knowledge.createDoc({ project: prj, title: 'UI', content: 'b', tags: ['ui'] });
    await knowledge.createDoc({ project: prj, title: 'Both', content: 'c', tags: ['api', 'ui'] });

    const api = await knowledge.listDocs({ project: prj, tag: 'api' });
    expect(api.length).toBe(2);
    const ui = await knowledge.listDocs({ project: prj, tag: 'ui' });
    expect(ui.length).toBe(2);
  });

  it('cross-project isolation', async () => {
    const prjA = uniqProj('list-proj-a');
    const prjB = uniqProj('list-proj-b');
    await knowledge.createDoc({ project: prjA, title: 'In A', content: 'a' });
    await knowledge.createDoc({ project: prjB, title: 'In B', content: 'b' });

    const listA = await knowledge.listDocs({ project: prjA });
    const listB = await knowledge.listDocs({ project: prjB });
    expect(listA.length).toBe(1);
    expect(listB.length).toBe(1);
    expect(listA[0].title).toBe('In A');
    expect(listB[0].title).toBe('In B');
  });

  it('default: excludes archived and trashed', async () => {
    const prj = uniqProj('list-default');
    const d1 = await knowledge.createDoc({ project: prj, title: 'Normal', content: 'a' });
    const d2 = await knowledge.createDoc({ project: prj, title: 'Archived', content: 'b' });
    const d3 = await knowledge.createDoc({ project: prj, title: 'Trashed', content: 'c' });
    await knowledge.archiveDoc(prj, d2.id);
    await knowledge.trashDoc(prj, d3.id);

    const list = await knowledge.listDocs({ project: prj });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(d1.id);
  });

  it('includeArchived shows archived but not trashed', async () => {
    const prj = uniqProj('list-archived');
    const d1 = await knowledge.createDoc({ project: prj, title: 'Normal', content: 'a' });
    const d2 = await knowledge.createDoc({ project: prj, title: 'Archived', content: 'b' });
    const d3 = await knowledge.createDoc({ project: prj, title: 'Trashed', content: 'c' });
    await knowledge.archiveDoc(prj, d2.id);
    await knowledge.trashDoc(prj, d3.id);

    const list = await knowledge.listDocs({ project: prj, includeArchived: true });
    const ids = list.map(d => d.id);
    expect(ids).toContain(d1.id);
    expect(ids).toContain(d2.id);
    expect(ids).not.toContain(d3.id);
  });

  it('includeTrashed shows trashed but not archived', async () => {
    const prj = uniqProj('list-trashed');
    const d1 = await knowledge.createDoc({ project: prj, title: 'Normal', content: 'a' });
    const d2 = await knowledge.createDoc({ project: prj, title: 'Archived', content: 'b' });
    const d3 = await knowledge.createDoc({ project: prj, title: 'Trashed', content: 'c' });
    await knowledge.archiveDoc(prj, d2.id);
    await knowledge.trashDoc(prj, d3.id);

    const list = await knowledge.listDocs({ project: prj, includeTrashed: true });
    const ids = list.map(d => d.id);
    expect(ids).toContain(d1.id);
    expect(ids).toContain(d3.id);
    expect(ids).not.toContain(d2.id);
  });

  it('sorted by updatedAt desc', async () => {
    const prj = uniqProj('list-sort');
    const d1 = await knowledge.createDoc({ project: prj, title: 'First', content: 'a' });
    await new Promise(r => setTimeout(r, 5));
    const d2 = await knowledge.createDoc({ project: prj, title: 'Second', content: 'b' });

    const list = await knowledge.listDocs({ project: prj });
    expect(list[0].id).toBe(d2.id);
    expect(list[1].id).toBe(d1.id);
  });

  it('lists docs across all projects when no project filter', async () => {
    const prjA = uniqProj('list-all-a');
    const prjB = uniqProj('list-all-b');
    await knowledge.createDoc({ project: prjA, title: 'In A', content: 'a' });
    await knowledge.createDoc({ project: prjB, title: 'In B', content: 'b' });

    const list = await knowledge.listDocs({});
    // There may be docs from other tests, but at minimum ours should be there
    const titles = list.map(d => d.title);
    expect(titles).toContain('In A');
    expect(titles).toContain('In B');
  });
});

// ---------------------------------------------------------------------------
// archive / trash / restore / delete lifecycle
// ---------------------------------------------------------------------------
describe('knowledge: lifecycle', () => {
  it('archive → restore roundtrip', async () => {
    const prj = uniqProj('lifecycle-arch');
    const doc = await knowledge.createDoc({ project: prj, title: 'Archive Test', content: 'c' });
    const archived = await knowledge.archiveDoc(prj, doc.id);
    expect(archived!.archived).toBe(true);

    const restored = await knowledge.restoreDoc(prj, doc.id);
    expect(restored!.archived).toBe(false);
    expect(restored!.trashed).toBe(false);

    // Verify content preserved
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.content).toBe('c');
  });

  it('trash → restore roundtrip', async () => {
    const prj = uniqProj('lifecycle-trash');
    const doc = await knowledge.createDoc({ project: prj, title: 'Trash Test', content: 'c' });
    const trashed = await knowledge.trashDoc(prj, doc.id);
    expect(trashed!.trashed).toBe(true);

    const restored = await knowledge.restoreDoc(prj, doc.id);
    expect(restored!.trashed).toBe(false);
  });

  it('deletePermanent removes the file', async () => {
    const prj = uniqProj('lifecycle-delete');
    const doc = await knowledge.createDoc({ project: prj, title: 'Delete Me', content: 'c' });
    const ok = await knowledge.deleteDocPermanent(prj, doc.id);
    expect(ok).toBe(true);
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read).toBeNull();
  });

  it('deletePermanent returns false for missing', async () => {
    const prj = uniqProj('lifecycle-delete-missing');
    const ok = await knowledge.deleteDocPermanent(prj, 'non-existent');
    expect(ok).toBe(false);
  });

  it('lifecycle ops return null for missing doc', async () => {
    const prj = uniqProj('lifecycle-missing');
    expect(await knowledge.archiveDoc(prj, 'nope')).toBeNull();
    expect(await knowledge.trashDoc(prj, 'nope')).toBeNull();
    expect(await knowledge.restoreDoc(prj, 'nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Frontmatter edge cases
// ---------------------------------------------------------------------------
describe('knowledge: frontmatter edge cases', () => {
  it('content with YAML-special characters', async () => {
    const prj = uniqProj('fm-special');
    const content = '# Title\n\nContent with: colons, {braces}, [brackets], and "quotes".';
    const doc = await knowledge.createDoc({ project: prj, title: 'Special Chars', content });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.content).toBe(content);
  });

  it('content with code blocks containing frontmatter-like markers', async () => {
    const prj = uniqProj('fm-codeblock');
    const content = '```yaml\n---\ntitle: fake\n---\n```\n\nReal content here.';
    const doc = await knowledge.createDoc({ project: prj, title: 'Code Block', content });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.content).toBe(content);
  });

  it('very long content', async () => {
    const prj = uniqProj('fm-long');
    const content = 'A'.repeat(50000);
    const doc = await knowledge.createDoc({ project: prj, title: 'Long', content });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.content).toBe(content);
  });

  it('content with unicode and emoji', async () => {
    const prj = uniqProj('fm-unicode');
    const content = 'Привет мир 🌍 مرحبا 日本語';
    const doc = await knowledge.createDoc({ project: prj, title: 'Unicode', content });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.content).toBe(content);
  });

  it('empty content', async () => {
    const prj = uniqProj('fm-empty');
    const doc = await knowledge.createDoc({ project: prj, title: 'Empty', content: '' });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.content).toBe('');
  });

  it('title with special characters', async () => {
    const prj = uniqProj('fm-title-special');
    const title = 'Title with "quotes" and : colons';
    const doc = await knowledge.createDoc({ project: prj, title, content: 'test' });
    const read = await knowledge.readDoc(prj, doc.id);
    expect(read!.title).toBe(title);
  });
});

// ---------------------------------------------------------------------------
// Hierarchy (parentId)
// ---------------------------------------------------------------------------
describe('knowledge: hierarchy', () => {
  it('stores and reads parentId', async () => {
    const prj = uniqProj('hier');
    const parent = await knowledge.createDoc({ project: prj, title: 'Parent', content: 'p' });
    const child = await knowledge.createDoc({ project: prj, title: 'Child', content: 'c', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);

    const read = await knowledge.readDoc(prj, child.id);
    expect(read!.parentId).toBe(parent.id);
  });

  it('update parentId (move in hierarchy)', async () => {
    const prj = uniqProj('hier-move');
    const parent1 = await knowledge.createDoc({ project: prj, title: 'P1', content: 'p1' });
    const parent2 = await knowledge.createDoc({ project: prj, title: 'P2', content: 'p2' });
    const child = await knowledge.createDoc({ project: prj, title: 'Child', content: 'c', parentId: parent1.id });

    const moved = await knowledge.updateDoc(prj, child.id, { parentId: parent2.id });
    expect(moved!.parentId).toBe(parent2.id);
  });

  it('detach from parent (set parentId to undefined)', async () => {
    const prj = uniqProj('hier-detach');
    const parent = await knowledge.createDoc({ project: prj, title: 'P', content: 'p' });
    const child = await knowledge.createDoc({ project: prj, title: 'C', content: 'c', parentId: parent.id });

    const detached = await knowledge.updateDoc(prj, child.id, { parentId: undefined });
    expect(detached!.parentId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listDocs with no matching docs
// ---------------------------------------------------------------------------
describe('knowledge: empty results', () => {
  it('returns empty array for empty project', async () => {
    // Use a very unique project name to avoid legacy file collisions
    const prj = `empty-proj-${crypto.randomUUID()}`;
    const list = await knowledge.listDocs({ project: prj });
    expect(list).toEqual([]);
  });

  it('returns empty array for non-matching tag', async () => {
    const prj = uniqProj('no-tag-match');
    await knowledge.createDoc({ project: prj, title: 'D1', content: 'a', tags: ['alpha'] });
    const list = await knowledge.listDocs({ project: prj, tag: 'non-existent' });
    expect(list).toEqual([]);
  });
});
