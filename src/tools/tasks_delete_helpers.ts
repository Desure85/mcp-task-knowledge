import { resolveProject } from "../config.js";
import { getTask, deleteTaskPermanent } from "../storage/tasks.js";

export async function handleTaskDelete({ project, id, confirm, dryRun }: { project: string; id: string; confirm?: boolean; dryRun?: boolean }) {
  const prj = resolveProject(project);
  if (dryRun) {
    const t = await getTask(prj, id);
    if (!t) return { ok: false as const, error: { message: `Task not found: ${project}/${id}` } };
    return { ok: true as const, data: t };
  }
  if (confirm === false) {
    return { ok: false as const, error: { message: "Deletion not confirmed: pass confirm=true to proceed" } };
  }
  const d = await deleteTaskPermanent(prj, id);
  if (!d) return { ok: false as const, error: { message: `Task not found: ${project}/${id}` } };
  return { ok: true as const, data: d };
}
