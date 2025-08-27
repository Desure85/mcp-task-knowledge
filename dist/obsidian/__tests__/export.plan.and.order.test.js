import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
let planExportProjectToVault;
let exportProjectToVault;
let createDoc;
let updateDoc;
let createTask;
let updateTask;
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
async function readAllFilesRec(root) {
    const out = {};
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            const rel = path.relative(root, full);
            if (e.isDirectory()) {
                await walk(full);
            }
            else {
                out[rel] = await fs.readFile(full, 'utf8');
            }
        }
    }
    try {
        await walk(root);
    }
    catch { }
    return out;
}
beforeAll(async () => {
    // Use isolated temp storage and vault
    TMP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-export-data-'));
    TMP_VAULT_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-export-vault-'));
    process.env.DATA_DIR = TMP_DATA_DIR;
    process.env.OBSIDIAN_VAULT_ROOT = TMP_VAULT_ROOT;
    process.env.EMBEDDINGS_MODE = 'none';
    ({ planExportProjectToVault, exportProjectToVault } = await import('../export'));
    ({ createDoc, updateDoc } = await import('../../storage/knowledge'));
    ({ createTask, updateTask } = await import('../../storage/tasks'));
    // Seed knowledge (three docs, 2 roots + one child)
    const k1 = await createDoc({ project: PROJECT, title: 'Alpha', content: 'Alpha body', tags: ['x'], type: 'component' });
    const k2 = await createDoc({ project: PROJECT, title: 'Gamma', content: 'Gamma body', tags: ['y'], type: 'note' });
    const k3 = await createDoc({ project: PROJECT, title: 'Beta', content: 'Beta body', parentId: k1.id, tags: ['x'], type: 'note' });
    // Stagger updatedAt to control order: k2 (newest) > k3 > k1 (oldest)
    await updateDoc(PROJECT, k1.id, { content: 'Alpha body v2' });
    await updateDoc(PROJECT, k3.id, { content: 'Beta body v2' });
    await updateDoc(PROJECT, k2.id, { content: 'Gamma body v2' });
    // Seed tasks (three nodes: root A -> child B, and root C)
    const t1 = await createTask({ project: PROJECT, title: 'Task A', description: 'A', tags: ['team'], priority: 'medium' });
    const t2 = await createTask({ project: PROJECT, title: 'Task B', description: 'B', tags: ['team'], priority: 'high', parentId: t1.id });
    const t3 = await createTask({ project: PROJECT, title: 'Task C', description: 'C', tags: ['ops'], priority: 'low' });
    // Statuses and updatedAt ordering: set in_progress/high for t2; make t3 newest
    await updateTask(PROJECT, t1.id, { status: 'pending' });
    await updateTask(PROJECT, t2.id, { status: 'in_progress', priority: 'high' });
    await updateTask(PROJECT, t3.id, { status: 'completed' });
});
afterAll(async () => {
    await rimraf(TMP_DATA_DIR);
    await rimraf(TMP_VAULT_ROOT);
});
describe('obsidian export — plan (merge/replace, filters, keepOrphans)', () => {
    it('merge plan with filters selects subset and ancestors; keepOrphans expands closure', async () => {
        const plan1 = await planExportProjectToVault(PROJECT, {
            strategy: 'merge',
            knowledge: true,
            tasks: true,
            includeTags: ['y', 'team'], // knowledge: pick Gamma (k2); tasks: allow tag 'team'
            includeStatus: ['in_progress'], // tasks: should pick Task B (t2)
            includePriority: ['high'],
            keepOrphans: false,
        });
        // knowledge: only k2 selected, no ancestors => 1
        expect(plan1.knowledgeCount).toBe(1);
        // tasks: t2 selected + ancestor t1 => 2
        expect(plan1.tasksCount).toBe(2);
        const plan2 = await planExportProjectToVault(PROJECT, {
            strategy: 'merge',
            knowledge: true,
            tasks: true,
            includeTags: ['y', 'team'],
            includeStatus: ['in_progress'],
            includePriority: ['high'],
            keepOrphans: true,
        });
        // keepOrphans => export all knowledge and all tasks regardless of selection
        expect(plan2.knowledgeCount).toBeGreaterThanOrEqual(3);
        expect(plan2.tasksCount).toBeGreaterThanOrEqual(3);
    });
    it('replace plan marks target dirs for deletion', async () => {
        const plan = await planExportProjectToVault(PROJECT, { strategy: 'replace', knowledge: true, tasks: true });
        expect(plan.willDeleteDirs.some((p) => p.endsWith(path.join(PROJECT, 'Knowledge')))).toBe(true);
        expect(plan.willDeleteDirs.some((p) => p.endsWith(path.join(PROJECT, 'Tasks')))).toBe(true);
    });
});
describe('obsidian export — deterministic output (replace twice)', () => {
    it('two consecutive replace exports produce identical file trees and contents', async () => {
        const vaultProjRoot = path.join(TMP_VAULT_ROOT, PROJECT);
        // 1st export
        const res1 = await exportProjectToVault(PROJECT, { strategy: 'replace', knowledge: true, tasks: true });
        expect(res1.knowledgeCount).toBeGreaterThan(0);
        expect(res1.tasksCount).toBeGreaterThan(0);
        const snap1 = await readAllFilesRec(vaultProjRoot);
        // 2nd export (no changes in storage)
        const res2 = await exportProjectToVault(PROJECT, { strategy: 'replace', knowledge: true, tasks: true });
        expect(res2.knowledgeCount).toBe(res1.knowledgeCount);
        expect(res2.tasksCount).toBe(res1.tasksCount);
        const snap2 = await readAllFilesRec(vaultProjRoot);
        // Compare keys and values strictly
        const keys1 = Object.keys(snap1).sort();
        const keys2 = Object.keys(snap2).sort();
        expect(keys2).toEqual(keys1);
        for (const k of keys1) {
            expect(snap2[k]).toBe(snap1[k]);
        }
    });
});
