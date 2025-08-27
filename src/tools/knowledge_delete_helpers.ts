import { resolveProject } from "../config.js";
import { readDoc, deleteDocPermanent } from "../storage/knowledge.js";

export async function handleKnowledgeDelete({ project, id, confirm, dryRun }: { project: string; id: string; confirm?: boolean; dryRun?: boolean }) {
  const prj = resolveProject(project);
  if (dryRun) {
    const doc = await readDoc(prj, id);
    if (!doc) return { ok: false as const, error: { message: `Doc not found: ${project}/${id}` } };
    return { ok: true as const, data: doc };
  }
  if (confirm === false) {
    return { ok: false as const, error: { message: "Deletion not confirmed: pass confirm=true to proceed" } };
  }
  const d = await deleteDocPermanent(prj, id);
  if (!d) return { ok: false as const, error: { message: `Doc not found: ${project}/${id}` } };
  return { ok: true as const, data: d };
}

export async function handleKnowledgeBulkDelete({ project, ids, confirm, dryRun }: { project: string; ids: string[]; confirm?: boolean; dryRun?: boolean }) {
  const prj = resolveProject(project);
  if (confirm === false) {
    return { ok: false as const, error: { message: "Bulk deletion not confirmed: pass confirm=true to proceed" } };
  }
  const results: Array<{ id: string; ok: boolean; data?: any; error?: { message: string } }> = [];
  for (const id of ids) {
    if (dryRun) {
      const doc = await readDoc(prj, id);
      if (!doc) results.push({ id, ok: false, error: { message: `Doc not found: ${project}/${id}` } });
      else results.push({ id, ok: true, data: doc });
      continue;
    }
    const d = await deleteDocPermanent(prj, id);
    if (!d) results.push({ id, ok: false, error: { message: `Doc not found: ${project}/${id}` } });
    else results.push({ id, ok: true, data: d });
  }
  return { ok: true as const, data: { count: results.length, results } };
}
