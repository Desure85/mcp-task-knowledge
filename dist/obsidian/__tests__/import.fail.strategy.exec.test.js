import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
let importProjectFromVault;
let createDoc;
let createTask;
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
    await writeFile(path.join(prjRoot, 'Knowledge', 'Zone1', 'A.md'), md({ title: 'A', tags: ['pub'], type: 'note' }, 'A body'));
    await writeFile(path.join(prjRoot, 'Tasks', 'Box', 'T.md'), md({ title: 'T', tags: ['team'], status: 'in_progress', priority: 'high' }, 'Task T'));
}
beforeAll(async () => {
    TMP_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-knowledge-data-'));
    TMP_VAULT_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-obsidian-vault-'));
    process.env.DATA_DIR = TMP_DATA_DIR;
    process.env.OBSIDIAN_VAULT_ROOT = TMP_VAULT_ROOT;
    await buildVault(TMP_VAULT_ROOT);
    ({ importProjectFromVault } = await import('../import'));
    ({ createDoc } = await import('../../storage/knowledge'));
    ({ createTask } = await import('../../storage/tasks'));
});
afterAll(async () => {
    await rimraf(TMP_DATA_DIR);
    await rimraf(TMP_VAULT_ROOT);
});
describe('obsidian import — mergeStrategy=fail', () => {
    it('throws on conflicts (existing titles)', async () => {
        // seed collisions: same titles as in vault
        await createDoc({ project: PROJECT, title: 'A', content: 'seed' });
        await createTask({ project: PROJECT, title: 'T', description: 'seed' });
        await expect(importProjectFromVault(PROJECT, {
            knowledge: true,
            tasks: true,
            strategy: 'merge',
            mergeStrategy: 'fail',
        })).rejects.toThrow(/conflicts/i);
    });
});
