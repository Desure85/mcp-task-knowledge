import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
let planImportProjectFromVault;
let createDoc;
let createTask;
let listDocs;
let listTasks;
const PROJECT = 'mcp';
let TMP_DATA_DIR = '';
let TMP_VAULT_ROOT = '';
async function rimraf(p) {
    try {
        await fs.rm(p, { recursive: true, force: true });
    }
    catch { }
}
async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true });
}
async function writeFile(p, content) {
    await ensureDir(path.dirname(p));
    await fs.writeFile(p, content, 'utf8');
}
function md(front, body = '') {
    const yaml = Object.entries(front)
        .map(([k, v]) => {
        if (Array.isArray(v))
            return `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}`;
        return `${k}: ${v}`;
    })
        .join('\n');
    return `---\n${yaml}\n---\n\n${body}`;
}
async function buildVault(root) {
    const prjRoot = path.join(root, PROJECT);
    // Knowledge: 2 items
    await writeFile(path.join(prjRoot, 'Knowledge', 'Zone1', 'INDEX.md'), md({ title: 'Zone1', tags: ['pub'], type: 'note' }, '# Zone1'));
    await writeFile(path.join(prjRoot, 'Knowledge', 'Zone1', 'A.md'), md({ title: 'A', tags: ['pub'], type: 'note' }, 'A body'));
    // Tasks: 2 items
    await writeFile(path.join(prjRoot, 'Tasks', 'Box', 'INDEX.md'), md({ title: 'Box', tags: ['team'], status: 'pending', priority: 'medium' }, '# Box'));
    await writeFile(path.join(prjRoot, 'Tasks', 'Box', 'T.md'), md({ title: 'T', tags: ['team'], status: 'in_progress', priority: 'high' }, 'Task T'));
}
beforeAll(async () => {
    TMP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-knowledge-data-'));
    TMP_VAULT_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-obsidian-vault-'));
    process.env.DATA_DIR = TMP_DATA_DIR;
    process.env.OBSIDIAN_VAULT_ROOT = TMP_VAULT_ROOT;
    await buildVault(TMP_VAULT_ROOT);
    ({ planImportProjectFromVault } = await import('../import'));
    ({ createDoc, listDocs } = await import('../../storage/knowledge'));
    ({ createTask, listTasks } = await import('../../storage/tasks'));
});
afterAll(async () => {
    await rimraf(TMP_DATA_DIR);
    await rimraf(TMP_VAULT_ROOT);
});
describe('obsidian import — dryRun plan (merge vs replace)', () => {
    it('merge: empty storage => all creates', async () => {
        const plan = await planImportProjectFromVault(PROJECT, {
            knowledge: true,
            tasks: true,
            strategy: 'merge',
        });
        expect(plan.deletes.knowledge).toBe(0);
        expect(plan.deletes.tasks).toBe(0);
        expect(plan.updates.knowledge).toBe(0);
        expect(plan.updates.tasks).toBe(0);
        expect(plan.creates.knowledge).toBe(2);
        expect(plan.creates.tasks).toBe(2);
    });
    it('merge: with existing titles => updates counted', async () => {
        // seed existing: knowledge title 'A' and task title 'Box'
        await createDoc({ project: PROJECT, title: 'A', content: 'seed' });
        await createTask({ project: PROJECT, title: 'Box', description: 'seed' });
        const plan = await planImportProjectFromVault(PROJECT, { strategy: 'merge' });
        // Expect updates for matched titles and creates for the rest
        expect(plan.deletes.knowledge).toBe(0);
        expect(plan.deletes.tasks).toBe(0);
        expect(plan.updates.knowledge).toBe(1);
        expect(plan.creates.knowledge).toBe(1);
        expect(plan.updates.tasks).toBe(1);
        expect(plan.creates.tasks).toBe(1);
    });
    it('replace: deletes existing and schedules fresh creates', async () => {
        // current storage has 1 knowledge + 1 task (seeded above)
        const metas = await listDocs({ project: PROJECT });
        const tasks = await listTasks({ project: PROJECT });
        expect(metas.length).toBe(1);
        expect(tasks.length).toBe(1);
        const plan = await planImportProjectFromVault(PROJECT, { strategy: 'replace' });
        expect(plan.deletes.knowledge).toBe(1);
        expect(plan.deletes.tasks).toBe(1);
        // Creates still reflect vault contents
        expect(plan.creates.knowledge).toBe(2);
        expect(plan.creates.tasks).toBe(2);
        // No updates in replace plan
        expect(plan.updates.knowledge).toBe(0);
        expect(plan.updates.tasks).toBe(0);
    });
});
