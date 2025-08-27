import { resolveProject } from "../config.js";
import { getTask, deleteTaskPermanent } from "../storage/tasks.js";
export async function handleTaskDelete({ project, id, confirm, dryRun }) {
    const prj = resolveProject(project);
    if (dryRun) {
        const t = await getTask(prj, id);
        if (!t)
            return { ok: false, error: { message: `Task not found: ${project}/${id}` } };
        return { ok: true, data: t };
    }
    if (confirm === false) {
        return { ok: false, error: { message: "Deletion not confirmed: pass confirm=true to proceed" } };
    }
    const d = await deleteTaskPermanent(prj, id);
    if (!d)
        return { ok: false, error: { message: `Task not found: ${project}/${id}` } };
    return { ok: true, data: d };
}
