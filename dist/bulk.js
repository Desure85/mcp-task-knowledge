import { resolveProject } from './config.js';
import { archiveDoc, restoreDoc, trashDoc, deleteDocPermanent, updateDoc } from './storage/knowledge.js';
async function mapResult(project, id, op, notFoundPrefix = 'Doc not found:') {
    try {
        const data = await op();
        if (!data)
            return { id, ok: false, error: { message: `${notFoundPrefix} ${project}/${id}` } };
        return { id, ok: true, data };
    }
    catch (e) {
        return { id, ok: false, error: { message: String(e?.message || e) } };
    }
}
export async function knowledgeBulkArchive(project, ids) {
    const prj = resolveProject(project);
    const results = [];
    for (const id of ids) {
        results.push(await mapResult(project, id, () => archiveDoc(prj, id)));
    }
    return { ok: true, data: { count: results.length, results } };
}
export async function knowledgeBulkTrash(project, ids) {
    const prj = resolveProject(project);
    const results = [];
    for (const id of ids) {
        results.push(await mapResult(project, id, () => trashDoc(prj, id)));
    }
    return { ok: true, data: { count: results.length, results } };
}
export async function knowledgeBulkRestore(project, ids) {
    const prj = resolveProject(project);
    const results = [];
    for (const id of ids) {
        results.push(await mapResult(project, id, () => restoreDoc(prj, id)));
    }
    return { ok: true, data: { count: results.length, results } };
}
export async function knowledgeBulkDeletePermanent(project, ids) {
    const prj = resolveProject(project);
    const results = [];
    for (const id of ids) {
        results.push(await mapResult(project, id, () => deleteDocPermanent(prj, id)));
    }
    return { ok: true, data: { count: results.length, results } };
}
export async function knowledgeBulkUpdate(project, items) {
    const prj = resolveProject(project);
    const results = [];
    for (const it of items) {
        const { id, ...patch } = it;
        results.push(await mapResult(project, id, () => updateDoc(prj, id, patch)));
    }
    return { ok: true, data: { count: results.length, results } };
}
