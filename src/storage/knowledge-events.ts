/**
 * Minimal change bus for knowledge documents.
 *
 * Storage emits; background indexers subscribe. This module deliberately has no
 * dependencies on search/config so `storage/knowledge.ts` does not have to import
 * the index pipeline (and tests that never subscribe pay nothing).
 */
export type KnowledgeChangeKind = 'created' | 'updated' | 'deleted' | 'restored';
export type KnowledgeChangeListener = (project: string, kind: KnowledgeChangeKind, id: string) => void;

const listeners = new Set<KnowledgeChangeListener>();

/** Subscribe to knowledge writes. Returns an unsubscribe function. */
export function onKnowledgeChanged(listener: KnowledgeChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Notify subscribers. Listener failures never break the write that triggered them. */
export function emitKnowledgeChanged(project: string, kind: KnowledgeChangeKind, id: string): void {
  for (const listener of listeners) {
    try {
      listener(project, kind, id);
    } catch {
      // A broken indexer must not fail a successful storage write.
    }
  }
}

/** Test helper — drop every subscriber between cases. */
export function resetKnowledgeListeners(): void {
  listeners.clear();
}
