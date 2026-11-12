import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendDraft, pendingDrafts, readJournal } from '../src/drafts/journal.js';
import { syncDrafts } from '../src/drafts/sync.js';
import { upsertKnowledgeByExternalKey } from '../src/drafts/upsert.js';
import { deleteDocPermanent, listDocs } from '../src/storage/knowledge.js';

describe('AA-04 draft journal and idempotent sync', () => {
  it('keeps 3 offline drafts pending and appends idempotent keys', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aa04-journal-'));
    try {
      for (let i = 1; i <= 3; i++) {
        await appendDraft(root, { key: `draft:ses_s#${i}`, project: 'p', title: `t${i}`, content: `c${i}` });
      }
      expect(await pendingDrafts(root)).toHaveLength(3);
      const duplicate = await appendDraft(root, { key: 'draft:ses_s#1', project: 'p', title: 'changed', content: 'x' });
      expect(duplicate.created).toBe(false);
      expect(duplicate.draft.title).toBe('t1');
      expect(await pendingDrafts(root)).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('acks after upsert, retries without duplicates', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aa04-sync-'));
    try {
      for (let i = 1; i <= 3; i++) {
        await appendDraft(root, { key: `draft:ses_s#${i}`, project: 'p', title: `t${i}`, content: `c${i}` });
      }
      const calls: string[] = [];
      const first = await syncDrafts(root, async (draft) => { calls.push(draft.key); });
      expect(first.synced).toBe(3);
      expect(first.failed).toEqual([]);
      expect(await pendingDrafts(root)).toHaveLength(0);

      const second = await syncDrafts(root, async (draft) => { calls.push(draft.key); });
      expect(second.synced).toBe(0);
      expect(calls).toHaveLength(3);
      expect((await readJournal(root)).acked.size).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resumes after a mid-batch failure without duplicating acked drafts', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aa04-fail-'));
    try {
      for (let i = 1; i <= 3; i++) {
        await appendDraft(root, { key: `draft:ses_s#${i}`, project: 'p', title: `t${i}`, content: `c${i}` });
      }
      const calls: string[] = [];
      const broken = await syncDrafts(root, async (draft) => {
        calls.push(draft.key);
        if (draft.key.endsWith('#2')) throw new Error('MCP down');
      });
      expect(broken.synced).toBe(2);
      expect(broken.failed.map((failure) => failure.key)).toEqual(['draft:ses_s#2']);
      expect((await pendingDrafts(root)).map((draft) => draft.key)).toEqual(['draft:ses_s#2']);

      const resumed = await syncDrafts(root, async (draft) => { calls.push(draft.key); });
      expect(resumed.synced).toBe(1);
      expect(await pendingDrafts(root)).toHaveLength(0);
      expect(calls.filter((key) => key.endsWith('#1'))).toHaveLength(1);
      expect(calls.filter((key) => key.endsWith('#3'))).toHaveLength(1);
      expect(calls.filter((key) => key.endsWith('#2'))).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serializes parallel appends without losing drafts', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aa04-parallel-'));
    try {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          appendDraft(root, { key: `draft:ses_${i}#1`, project: 'p', title: `t${i}`, content: `c${i}` })),
      );
      expect(await pendingDrafts(root)).toHaveLength(20);
      expect((await readJournal(root)).drafts).toHaveLength(20);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('upserts knowledge by externalKey exactly once', async () => {
    const project = `aa04-upsert-${Date.now()}`;
    try {
      const first = await upsertKnowledgeByExternalKey({
        project,
        externalKey: 'draft:ses_x#1',
        title: 'Draft',
        content: 'one',
      });
      expect(first.action).toBe('created');
      const second = await upsertKnowledgeByExternalKey({
        project,
        externalKey: 'draft:ses_x#1',
        title: 'Draft updated',
        content: 'two',
      });
      expect(second.action).toBe('updated');
      expect(second.doc.id).toBe(first.doc.id);
      const docs = (await listDocs({ project })).filter((doc) => doc.externalKey === 'draft:ses_x#1');
      expect(docs).toHaveLength(1);
      expect(docs[0]!.title).toBe('Draft updated');
    } finally {
      for (const doc of await listDocs({ project, includeArchived: true, includeTrashed: true })) {
        await deleteDocPermanent(project, doc.id);
      }
    }
  });
});
