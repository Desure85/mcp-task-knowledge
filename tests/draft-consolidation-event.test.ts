import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { appendDraft, pendingDrafts } from '../src/drafts/journal.js';
import { consolidateDrafts } from '../src/drafts/consolidate.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-draft-consolidation');

beforeAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(ROOT, { recursive: true }); });
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('AA-06 draft consolidation event', () => {
  it('writes facts/patterns once and emits one sync event', async () => {
    await appendDraft(ROOT, { key: 'k1', project: 'mcp', title: 'Fact one', content: 'body', tags: ['t'] });
    await appendDraft(ROOT, { key: 'k2', project: 'mcp', title: 'Fact two', content: 'body' });
    expect((await pendingDrafts(ROOT)).length).toBe(2);

    const first = await consolidateDrafts(ROOT);
    expect(first.facts).toBe(2);
    expect(first.patterns).toBe(2);
    expect(first.eventEmitted).toBe(true);
    expect(first.acked).toEqual(['k1', 'k2']);
    expect(await pendingDrafts(ROOT)).toHaveLength(0);

    const facts = await fsp.readFile(path.join(ROOT, 'facts.md'), 'utf8');
    expect(facts).toContain('[draft:k1] Fact one');
    expect(facts).toContain('[draft:k2] Fact two');
    const events = (await fsp.readFile(path.join(ROOT, 'sync-events.jsonl'), 'utf8')).trim().split('\n');
    expect(events).toHaveLength(1);

    const second = await consolidateDrafts(ROOT);
    expect(second.facts).toBe(0);
    expect(second.eventEmitted).toBe(false);
    expect((await fsp.readFile(path.join(ROOT, 'facts.md'), 'utf8')).match(/\[draft:k1\]/g)).toHaveLength(1);
    expect((await fsp.readFile(path.join(ROOT, 'sync-events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});
