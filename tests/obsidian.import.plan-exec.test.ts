/**
 * TR-04a: replaces the deleted cli-envelope smoke test with a real in-process
 * exercise of planImportProjectFromVault + importProjectFromVault. The smoke
 * test only asserted `typeof count === 'number'` on hand-built envelopes and
 * was the only in-process cover for creating new knowledge docs and tasks
 * from INDEX.md folders.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), `tr04a-import-${process.pid}-${Date.now()}`);
const DATA = path.join(TMP, 'data');
const VAULT = path.join(TMP, 'vault');
const PROJECT = 'mcp';

// Must be set before config.ts is loaded (dynamic imports below).
process.env.DATA_DIR = DATA;
process.env.OBSIDIAN_VAULT_ROOT = VAULT;

let imp: typeof import('../src/obsidian/import.js');
let kb: typeof import('../src/storage/knowledge.js');
let tasksApi: typeof import('../src/storage/tasks.js');

function md(front: Record<string, unknown>, body = ''): string {
  const yaml = Object.entries(front)
    .map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}` : `${k}: ${v}`))
    .join('\n');
  return `---\n${yaml}\n---\n\n${body}`;
}

async function writeFile(p: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf8');
}

beforeAll(async () => {
  await fsp.mkdir(DATA, { recursive: true });
  const knowledgeDir = path.join(VAULT, PROJECT, 'Knowledge', 'Notes');
  await writeFile(path.join(knowledgeDir, 'INDEX.md'), md({ title: 'Notes', type: 'note', tags: ['x'] }, '# Notes'));
  await writeFile(path.join(knowledgeDir, 'leaf.md'), md({ title: 'Leaf', type: 'note', tags: ['y'] }, 'leaf body'));

  const tasksDir = path.join(VAULT, PROJECT, 'Tasks', 'Inbox');
  await writeFile(
    path.join(tasksDir, 'INDEX.md'),
    md({ title: 'Inbox', status: 'pending', priority: 'low', tags: ['t'] }, '# Inbox'),
  );
  await writeFile(
    path.join(tasksDir, 't1.md'),
    md({ title: 'T1', status: 'pending', priority: 'medium' }, 'task body'),
  );

  imp = await import('../src/obsidian/import.js');
  kb = await import('../src/storage/knowledge.js');
  tasksApi = await import('../src/storage/tasks.js');
});

afterAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

describe('obsidian import: real plan + exec (merge, new docs and tasks)', () => {
  it('plans exact creates and imports real docs/tasks with hierarchy and content', async () => {
    const opts = { knowledge: true, tasks: true, strategy: 'merge' as const, mergeStrategy: 'overwrite' as const };

    const plan = await imp.planImportProjectFromVault(PROJECT, opts);
    expect(plan.creates.knowledge).toBe(2);
    expect(plan.creates.tasks).toBe(2);

    const result = await imp.importProjectFromVault(PROJECT, opts);
    expect(result.knowledgeImported).toBe(2);
    expect(result.tasksImported).toBe(2);

    const docs = await kb.listDocs({ project: PROJECT });
    const docsByTitle = new Map(docs.map((d) => [d.title, d] as const));
    expect(docsByTitle.has('Notes')).toBe(true);
    expect(docsByTitle.has('Leaf')).toBe(true);
    expect(docsByTitle.get('Leaf')!.parentId).toBe(docsByTitle.get('Notes')!.id);
    const leaf = await kb.readDoc(PROJECT, docsByTitle.get('Leaf')!.id);
    expect(leaf?.content).toContain('leaf body');
    expect(leaf?.tags).toContain('y');

    const importedTasks = await tasksApi.listTasks({ project: PROJECT });
    const tasksByTitle = new Map(importedTasks.map((t) => [t.title, t] as const));
    expect(tasksByTitle.has('Inbox')).toBe(true);
    expect(tasksByTitle.has('T1')).toBe(true);
    expect(tasksByTitle.get('T1')!.parentId).toBe(tasksByTitle.get('Inbox')!.id);
    expect(tasksByTitle.get('T1')!.description).toContain('task body');
  });
});
