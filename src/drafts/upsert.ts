/** AA-04: upsert a knowledge document by stable external key. */
import type { KnowledgeDoc } from '../types.js';
import { createDoc, listDocs, updateDoc } from '../storage/knowledge.js';

export interface UpsertKnowledgeInput {
  project: string;
  externalKey: string;
  title: string;
  content: string;
  tags?: string[];
}

export async function upsertKnowledgeByExternalKey(
  input: UpsertKnowledgeInput,
): Promise<{ doc: KnowledgeDoc; action: 'created' | 'updated' }> {
  const all = await listDocs({ project: input.project, includeArchived: true, includeTrashed: true });
  const existing = all.find((doc) => doc.externalKey === input.externalKey);
  if (existing) {
    const updated = await updateDoc(input.project, existing.id, {
      title: input.title,
      content: input.content,
      tags: input.tags ?? existing.tags,
      externalKey: input.externalKey,
    });
    if (!updated) throw new Error(`knowledge doc disappeared: ${existing.id}`);
    return { doc: updated, action: 'updated' };
  }
  const doc = await createDoc({
    project: input.project,
    title: input.title,
    content: input.content,
    tags: input.tags,
    externalKey: input.externalKey,
  });
  return { doc, action: 'created' };
}
