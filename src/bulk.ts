import { resolveProject } from './config.js';
import { archiveDoc, restoreDoc, trashDoc, deleteDocPermanent, updateDoc } from './storage/knowledge.js';

export type BulkResult<T> = {
  id: string;
  ok: boolean;
  data?: T;
  error?: { message: string };
};

export type BulkEnvelope<T> = {
  ok: true;
  data: { count: number; results: Array<BulkResult<T>> };
};

async function mapResult<T>(project: string, id: string, op: () => Promise<T | null>, notFoundPrefix = 'Doc not found:'): Promise<BulkResult<T>> {
  try {
    const data = await op();
    if (!data) return { id, ok: false, error: { message: `${notFoundPrefix} ${project}/${id}` } };
    return { id, ok: true, data };
  } catch (e: any) {
    return { id, ok: false, error: { message: String(e?.message || e) } };
  }
}

export async function knowledgeBulkArchive(project: string, ids: string[]): Promise<BulkEnvelope<any>> {
  const prj = resolveProject(project);
  const results: Array<BulkResult<any>> = [];
  for (const id of ids) {
    results.push(await mapResult(project, id, () => archiveDoc(prj, id)));
  }
  return { ok: true, data: { count: results.length, results } };
}

export async function knowledgeBulkTrash(project: string, ids: string[]): Promise<BulkEnvelope<any>> {
  const prj = resolveProject(project);
  const results: Array<BulkResult<any>> = [];
  for (const id of ids) {
    results.push(await mapResult(project, id, () => trashDoc(prj, id)));
  }
  return { ok: true, data: { count: results.length, results } };
}

export async function knowledgeBulkRestore(project: string, ids: string[]): Promise<BulkEnvelope<any>> {
  const prj = resolveProject(project);
  const results: Array<BulkResult<any>> = [];
  for (const id of ids) {
    results.push(await mapResult(project, id, () => restoreDoc(prj, id)));
  }
  return { ok: true, data: { count: results.length, results } };
}

export async function knowledgeBulkDeletePermanent(project: string, ids: string[]): Promise<BulkEnvelope<any>> {
  const prj = resolveProject(project);
  const results: Array<BulkResult<any>> = [];
  for (const id of ids) {
    results.push(await mapResult(project, id, () => deleteDocPermanent(prj, id)));
  }
  return { ok: true, data: { count: results.length, results } };
}

export async function knowledgeBulkUpdate(
  project: string,
  items: Array<{
    id: string;
    title?: string;
    content?: string;
    tags?: string[];
    source?: string;
    parentId?: string | null;
    type?: string;
  }>
): Promise<BulkEnvelope<any>> {
  const prj = resolveProject(project);
  const results: Array<BulkResult<any>> = [];
  for (const it of items) {
    const { id, ...patch } = it as any;
    results.push(await mapResult(project, id, () => updateDoc(prj, id, patch as any)));
  }
  return { ok: true, data: { count: results.length, results } };
}
