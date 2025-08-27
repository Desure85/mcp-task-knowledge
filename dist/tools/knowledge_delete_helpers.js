import { resolveProject } from "../config.js";
import { readDoc, deleteDocPermanent } from "../storage/knowledge.js";
export async function handleKnowledgeDelete({ project, id, confirm, dryRun }) {
    const prj = resolveProject(project);
    if (dryRun) {
        const doc = await readDoc(prj, id);
        if (!doc)
            return { ok: false, error: { message: `Doc not found: ${project}/${id}` } };
        return { ok: true, data: doc };
    }
    if (confirm === false) {
        return { ok: false, error: { message: "Deletion not confirmed: pass confirm=true to proceed" } };
    }
    const d = await deleteDocPermanent(prj, id);
    if (!d)
        return { ok: false, error: { message: `Doc not found: ${project}/${id}` } };
    return { ok: true, data: d };
}
export async function handleKnowledgeBulkDelete({ project, ids, confirm, dryRun }) {
    const prj = resolveProject(project);
    if (confirm === false) {
        return { ok: false, error: { message: "Bulk deletion not confirmed: pass confirm=true to proceed" } };
    }
    const results = [];
    for (const id of ids) {
        if (dryRun) {
            const doc = await readDoc(prj, id);
            if (!doc)
                results.push({ id, ok: false, error: { message: `Doc not found: ${project}/${id}` } });
            else
                results.push({ id, ok: true, data: doc });
            continue;
        }
        const d = await deleteDocPermanent(prj, id);
        if (!d)
            results.push({ id, ok: false, error: { message: `Doc not found: ${project}/${id}` } });
        else
            results.push({ id, ok: true, data: d });
    }
    return { ok: true, data: { count: results.length, results } };
}
