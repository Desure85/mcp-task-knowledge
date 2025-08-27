import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-knowledge-single');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic imports after env
import type * as KnowledgeNS from '../src/storage/knowledge.js';
let knowledge!: typeof KnowledgeNS;

async function rmrf(p: string) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {}
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

describe('knowledge single operations', () => {
  it('create returns metadata and content; read returns same', async () => {
    const project = 'mcp';
    const title = 'Single/Create Test';
    const content = '# H1\nBody';
    const tags = ['mcp', 'test'];
    const doc = await knowledge.createDoc({ project, title, content, tags, source: 'unit', parentId: undefined, type: 'note' });

    expect(doc.id).toBeTruthy();
    expect(doc.project).toBe(project);
    expect(doc.title).toBe(title);
    expect(doc.content).toBe(content);
    expect(doc.tags).toEqual(tags);
    expect(doc.archived).toBe(false);
    expect(doc.trashed).toBe(false);

    const got = await knowledge.readDoc(project, doc.id);
    expect(got?.id).toBe(doc.id);
    expect(got?.content).toContain('Body');
  });

  it('archive -> archived=true; unarchive (restore) -> archived=false', async () => {
    const project = 'mcp';
    const d = await knowledge.createDoc({ project, title: 'Arch', content: 'a' });

    const archived = await knowledge.archiveDoc(project, d.id);
    expect(archived?.archived).toBe(true);

    const unarchived = await knowledge.restoreDoc(project, d.id);
    expect(unarchived?.archived).toBe(false);
    expect(unarchived?.trashed).toBe(false);
  });

  it('trash -> trashed=true; restore -> trashed=false', async () => {
    const project = 'mcp';
    const d = await knowledge.createDoc({ project, title: 'TrashMe', content: 'x' });

    const trashed = await knowledge.trashDoc(project, d.id);
    expect(trashed?.trashed).toBe(true);

    const restored = await knowledge.restoreDoc(project, d.id);
    expect(restored?.trashed).toBe(false);
    expect(restored?.archived).toBe(false);
  });

  it('delete permanent removes the file; subsequent read returns null', async () => {
    const project = 'mcp';
    const d = await knowledge.createDoc({ project, title: 'ToDeleteSingle', content: 'x' });

    const ok = await knowledge.deleteDocPermanent(project, d.id);
    expect(ok).toBe(true);

    const after = await knowledge.readDoc(project, d.id);
    expect(after).toBeNull();
  });

  it('operations on missing id return null/false', async () => {
    const project = 'mcp';
    const missing = 'no-such-id';

    const a = await knowledge.archiveDoc(project, missing);
    const t = await knowledge.trashDoc(project, missing);
    const r = await knowledge.restoreDoc(project, missing);
    const d = await knowledge.deleteDocPermanent(project, missing);

    expect(a).toBeNull();
    expect(t).toBeNull();
    expect(r).toBeNull();
    expect(d).toBe(false);
  });
});
