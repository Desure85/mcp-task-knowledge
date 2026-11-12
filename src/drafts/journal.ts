/**
 * AA-04: append-only draft journal. A draft is never overwritten: every append is
 * an event line, and the derived index keeps the latest draft per idempotent key.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDir, pathExists, readText, withFileLock } from '../fs.js';

export interface DraftInput {
  key: string;
  project: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface DraftRecord extends DraftInput {
  id: string;
  createdAt: string;
}

export interface DraftAck {
  type: 'acked';
  key: string;
  at: string;
}

type JournalEvent = ({ type: 'draft' } & DraftRecord) | DraftAck;

export interface DraftJournalState {
  drafts: DraftRecord[];
  acked: Set<string>;
}

function journalFile(root: string): string {
  return path.join(root, 'journal.jsonl');
}

async function readEvents(root: string): Promise<JournalEvent[]> {
  const file = journalFile(root);
  if (!(await pathExists(file))) return [];
  const text = await readText(file);
  const events: JournalEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as JournalEvent);
    } catch {
      // A torn trailing line is ignored; the journal itself is append-only.
    }
  }
  return events;
}

export async function readJournal(root: string): Promise<DraftJournalState> {
  const events = await readEvents(root);
  const byKey = new Map<string, DraftRecord>();
  const acked = new Set<string>();
  for (const event of events) {
    if (event.type === 'draft') byKey.set(event.key, event);
    else acked.add(event.key);
  }
  return { drafts: [...byKey.values()], acked };
}

export async function pendingDrafts(root: string): Promise<DraftRecord[]> {
  const state = await readJournal(root);
  return state.drafts.filter((draft) => !state.acked.has(draft.key));
}

/** Idempotent by key: appending an existing key returns the stored draft. */
export async function appendDraft(root: string, input: DraftInput): Promise<{ draft: DraftRecord; created: boolean }> {
  return withFileLock(`draft-journal:${root}`, async () => {
    const state = await readJournal(root);
    const existing = state.drafts.find((draft) => draft.key === input.key);
    if (existing) return { draft: existing, created: false };
    const draft: DraftRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await ensureDir(root);
    await fs.appendFile(journalFile(root), `${JSON.stringify({ type: 'draft', ...draft })}\n`, 'utf8');
    return { draft, created: true };
  });
}

export async function ackDraft(root: string, key: string): Promise<void> {
  await withFileLock(`draft-journal:${root}`, async () => {
    const state = await readJournal(root);
    if (state.acked.has(key)) return;
    await ensureDir(root);
    const ack: DraftAck = { type: 'acked', key, at: new Date().toISOString() };
    await fs.appendFile(journalFile(root), `${JSON.stringify(ack)}\n`, 'utf8');
  });
}
