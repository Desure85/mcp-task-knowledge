import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { TASKS_DIR } from '../config.js';
import { ensureDir, pathExists, readJson, writeJson } from '../fs.js';
import { promises as fs } from 'node:fs';
export async function tasksProjectDir(project) {
    const dir = path.join(TASKS_DIR, project);
    await ensureDir(dir);
    return dir;
}
// Soft-delete helpers
export async function archiveTask(project, id) {
    return updateTask(project, id, { archived: true, archivedAt: new Date().toISOString() });
}
export async function trashTask(project, id) {
    return updateTask(project, id, { trashed: true, trashedAt: new Date().toISOString() });
}
export async function restoreTask(project, id) {
    return updateTask(project, id, { archived: false, trashed: false });
}
export async function deleteTaskPermanent(project, id) {
    const p = path.join(TASKS_DIR, project, `${id}.json`);
    if (!(await pathExists(p)))
        return false;
    await fs.unlink(p);
    return true;
}
export async function createTask(input) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const task = {
        id,
        project: input.project,
        title: input.title,
        description: input.description,
        status: 'pending',
        priority: input.priority || 'medium',
        tags: input.tags || [],
        links: input.links || [],
        createdAt: now,
        updatedAt: now,
        parentId: input.parentId,
        archived: false,
        trashed: false,
    };
    const filePath = path.join(await tasksProjectDir(input.project), `${id}.json`);
    await writeJson(filePath, task);
    return task;
}
export async function listTasks(filter) {
    const projects = filter?.project ? [filter.project] : await listAllProjects();
    const results = [];
    for (const project of projects) {
        // Prefer modern layout: TASKS_DIR/<project>/
        let dir = path.join(TASKS_DIR, project);
        if (!(await pathExists(dir))) {
            // Legacy flat layout fallback: TASKS_DIR/* without per-project subdir
            if (await pathExists(TASKS_DIR)) {
                dir = TASKS_DIR;
            }
            else {
                continue;
            }
        }
        const files = await (await import('node:fs/promises')).readdir(dir);
        for (const f of files) {
            if (!f.endsWith('.json'))
                continue;
            const t = await readJson(path.join(dir, f));
            // skip trashed by default unless explicitly included
            if (!filter?.includeTrashed && t.trashed)
                continue;
            // skip archived by default unless explicitly included
            if (!filter?.includeArchived && t.archived)
                continue;
            if (filter?.status && t.status !== filter.status)
                continue;
            if (filter?.tag && !(t.tags || []).includes(filter.tag))
                continue;
            results.push(t);
        }
    }
    // Sort by updatedAt desc (guarding undefined)
    results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return results;
}
export async function listTasksTree(filter) {
    const items = await listTasks(filter);
    // Build id -> node map
    const map = new Map();
    for (const t of items) {
        map.set(t.id, { ...t, children: [] });
    }
    const roots = [];
    for (const node of map.values()) {
        if (node.parentId && map.has(node.parentId)) {
            const parent = map.get(node.parentId);
            // Ensure parent-child only within same project
            if (parent.project === node.project) {
                parent.children.push(node);
                continue;
            }
        }
        roots.push(node);
    }
    // Sort helper by updatedAt desc
    const sortRec = (n) => {
        n.children.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        n.children.forEach(sortRec);
    };
    roots.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    roots.forEach(sortRec);
    return roots;
}
export async function getTask(project, id) {
    const p = path.join(TASKS_DIR, project, `${id}.json`);
    if (!(await pathExists(p)))
        return null;
    return readJson(p);
}
export async function updateTask(project, id, patch) {
    const existing = await getTask(project, id);
    if (!existing)
        return null;
    // If parentId is being modified, validate new parent existence and protect against cycles
    const hasParentPatch = Object.prototype.hasOwnProperty.call(patch, 'parentId');
    let normalizedPatch = { ...patch };
    if (hasParentPatch) {
        const items = await listTasks({ project, includeArchived: true });
        const byId = new Map(items.map((t) => [t.id, t]));
        // Normalize null -> undefined (detach to root)
        let parentId = normalizedPatch.parentId;
        if (parentId === null)
            parentId = undefined;
        if (parentId) {
            const parent = byId.get(parentId);
            if (!parent) {
                throw new Error(`Parent not found: ${project}/${parentId}`);
            }
            // Cycle check: walk up from target parent to root
            let p = parent.parentId;
            while (p) {
                if (p === id) {
                    throw new Error(`Cycle detected: cannot move ${id} under ${parentId}`);
                }
                p = byId.get(p)?.parentId;
            }
        }
        normalizedPatch.parentId = parentId;
    }
    const updated = {
        ...existing,
        ...normalizedPatch,
        id: existing.id,
        project: existing.project,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
    };
    const p = path.join(TASKS_DIR, project, `${id}.json`);
    await writeJson(p, updated);
    return updated;
}
export async function closeTask(project, id) {
    return updateTask(project, id, { status: 'closed' });
}
async function listAllProjects() {
    const fs = await import('node:fs/promises');
    try {
        const entries = (await fs.readdir(TASKS_DIR, { withFileTypes: true }));
        const projects = [];
        for (const e of entries) {
            if (!e.isDirectory())
                continue;
            projects.push(e.name);
        }
        return projects;
    }
    catch {
        return [];
    }
}
