/** AA-04: drain the append-only draft journal into a caller-provided upsert. */
import { ackDraft, pendingDrafts, type DraftRecord } from './journal.js';

export interface DraftSyncResult {
  synced: number;
  failed: Array<{ key: string; error: string }>;
}

/**
 * A draft is acknowledged only after the upsert succeeds, one draft at a time.
 * A mid-batch outage leaves the remaining drafts pending; a retry resumes without
 * duplicating already-acked keys.
 */
export async function syncDrafts(
  root: string,
  upsert: (draft: DraftRecord) => Promise<void>,
): Promise<DraftSyncResult> {
  const pending = await pendingDrafts(root);
  let synced = 0;
  const failed: Array<{ key: string; error: string }> = [];
  for (const draft of pending) {
    try {
      await upsert(draft);
      await ackDraft(root, draft.key);
      synced++;
    } catch (error) {
      failed.push({ key: draft.key, error: (error as Error).message });
    }
  }
  return { synced, failed };
}
