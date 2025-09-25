import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// We must set env before importing server modules that read config at import-time
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-task-knowledge-test-'));
process.env.DATA_DIR = TMP_ROOT;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_ROOT, 'obsidian');
process.env.EMBEDDINGS_MODE = 'none';

// Lazy imports after env set
let tasksMod: typeof import('../storage/tasks.js');
let knowledgeMod: typeof import('../storage/knowledge.js');
let projectsMod: typeof import('../projects.js');
let configMod: typeof import('../config.js');
let searchMod: typeof import('../search/index.js');

async function importAll() {
  tasksMod = await import('../storage/tasks.js');
  knowledgeMod = await import('../storage/knowledge.js');
  projectsMod = await import('../projects.js');
  configMod = await import('../config.js');
  searchMod = await import('../search/index.js');
}

function sortByUpdatedDesc<T extends { updatedAt?: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

describe('Resources semantics (without stdio)', () => {
  const P1 = 'mcp';
  const P2 = 'neirogen';
  const createdTasks: any[] = [];
  const createdDocs: any[] = [];

  beforeAll(async () => {
    fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
    fs.mkdirSync(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
    await importAll();

    // Create tasks across projects with varied statuses, tags, and parent-child
    const t1 = await tasksMod.createTask({ project: P1, title: 'Root A', tags: ['infra'] });
    const t2 = await tasksMod.createTask({ project: P1, title: 'Child A1', parentId: t1.id, tags: ['infra'] });
    const t3 = await tasksMod.createTask({ project: P1, title: 'Bug B', tags: ['bug'], description: 'Fix issue' });
    const t4 = await tasksMod.createTask({ project: P2, title: 'Spec Doc', tags: ['docs'] });
    const t5 = await tasksMod.createTask({ project: P2, title: 'Closed Task', tags: ['ops'] });
    await tasksMod.updateTask(P2, t5.id, { status: 'closed' as any });
    // Archive and trash some to test default filters
    const t6 = await tasksMod.createTask({ project: P1, title: 'Archived', tags: ['old'] });
    await tasksMod.archiveTask(P1, t6.id);
    const t7 = await tasksMod.createTask({ project: P1, title: 'Trashed', tags: ['old'] });
    await tasksMod.trashTask(P1, t7.id);
    createdTasks.push(t1, t2, t3, t4, t5, t6, t7);

    // Create knowledge docs with tags and types
    const d1 = await knowledgeMod.createDoc({ project: P1, title: 'Runbook', content: '# Runbook', tags: ['ops'], type: 'note' });
    const d2 = await knowledgeMod.createDoc({ project: P1, title: 'Spec X', content: '# Spec', tags: ['spec'], type: 'spec' });
    const d3 = await knowledgeMod.createDoc({ project: P2, title: 'Untagged', content: 'text' });
    createdDocs.push(d1, d2, d3);
  });

  afterAll(() => {
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
  });

  it('project://projects semantics (listProjects)', async () => {
    const data = await projectsMod.listProjects(configMod.getCurrentProject);
    const ids = (data.projects || []).map((p: any) => p.id);
    expect(ids).toContain(P1);
    expect(ids).toContain(P2);
  });

  it('tasks://project/{id} default filters exclude archived/trashed', async () => {
    const itemsP1 = await tasksMod.listTasks({ project: P1, includeArchived: false, includeTrashed: false });
    const ids = itemsP1.map((t) => t.title);
    expect(ids).toContain('Root A');
    expect(ids).not.toContain('Archived');
    expect(ids).not.toContain('Trashed');
  });

  it('tasks://project/{id}/status/closed', async () => {
    const closed = await tasksMod.listTasks({ project: P2, status: 'closed' as any, includeArchived: false });
    expect(closed.find((t) => t.title === 'Closed Task')).toBeTruthy();
  });

  it('tasks://project/{id}/tag/{tag}', async () => {
    const infra = await tasksMod.listTasks({ project: P1, tag: 'infra', includeArchived: false });
    const titles = infra.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Root A','Child A1']));
  });

  it('tasks://current and tasks://current/tree reflect getCurrentProject', async () => {
    configMod.setCurrentProject(P1);
    const items = await tasksMod.listTasks({ project: configMod.getCurrentProject(), includeArchived: false });
    expect(items.every((t) => t.project === P1)).toBe(true);

    const tree = await tasksMod.listTasksTree({ project: configMod.getCurrentProject(), includeArchived: false });
    const root = tree.find((n) => n.title === 'Root A');
    expect(root).toBeTruthy();
    expect(root!.children.find((c) => c.title === 'Child A1')).toBeTruthy();
  });

  it('task actions: start/complete/close/trash/restore/archive', async () => {
    const p = P1;
    const t = await tasksMod.createTask({ project: p, title: 'Transit' });
    await tasksMod.updateTask(p, t.id, { status: 'in_progress' as any });
    let got = await tasksMod.updateTask(p, t.id, { status: 'completed' as any });
    expect(got?.status).toBe('completed');
    got = await tasksMod.closeTask(p, t.id);
    expect(got?.status).toBe('closed');
    await tasksMod.trashTask(p, t.id);
    const trashed = await tasksMod.listTasks({ project: p, includeTrashed: true });
    expect(trashed.find((x) => x.id === t.id)?.trashed).toBe(true);
    await tasksMod.restoreTask(p, t.id);
    const restored = await tasksMod.listTasks({ project: p });
    expect(restored.find((x) => x.id === t.id)?.trashed).toBeFalsy();
    await tasksMod.archiveTask(p, t.id);
    const archived = await tasksMod.listTasks({ project: p, includeArchived: true });
    expect(archived.find((x) => x.id === t.id)?.archived).toBe(true);
  });

  it('knowledge://current and tree grouping by first tag', async () => {
    configMod.setCurrentProject(P1);
    const docs = await knowledgeMod.listDocs({ project: configMod.getCurrentProject(), includeArchived: false });
    const tags = new Map<string, number>();
    for (const d of docs) {
      const t = Array.isArray(d.tags) && d.tags.length ? String(d.tags[0]) : 'untagged';
      tags.set(t, (tags.get(t) || 0) + 1);
    }
    expect(tags.get('ops')).toBe(1);
    expect(tags.get('spec')).toBe(1);
  });

  it('knowledge filters by project/tag/type', async () => {
    const p1docs = await knowledgeMod.listDocs({ project: P1 });
    expect(p1docs.every((d) => d.project === P1)).toBe(true);
    const tagOps = p1docs.filter((d) => (d.tags || []).includes('ops'));
    expect(tagOps.length).toBe(1);
    // type check via reading full doc
    const metas = await knowledgeMod.listDocs({ project: P1 });
    const full = await Promise.all(metas.map((m) => knowledgeMod.readDoc(P1, m.id)));
    const typeSpec = full.filter((d) => (d?.type || '').toLowerCase() === 'spec');
    expect(typeSpec.length).toBe(1);
  });

  it('search tasks hybrid (BM25 fallback when vectors disabled)', async () => {
    const tasks = await tasksMod.listTasks({ project: P1 });
    const items = tasks.map((t) => ({ id: t.id, text: `${t.title}\n${t.description || ''}\n${(t.tags||[]).join(' ')}`, item: t }));
    const results = await searchMod.hybridSearch('Root', items, { limit: 5, vectorAdapter: undefined });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('search knowledge two-stage (BM25-only when vectors disabled)', async () => {
    const metas = await knowledgeMod.listDocs({ project: P1 });
    const docs = (await Promise.all(metas.map((m) => knowledgeMod.readDoc(P1, m.id)))).filter(Boolean) as any[];
    const results = await searchMod.twoStageHybridKnowledgeSearch('Spec', docs, { limit: 5, vectorAdapter: undefined });
    expect(Array.isArray(results)).toBe(true);
  });
});
