/** AA-06: consolidate pending drafts into facts/patterns and emit one sync event. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDir, pathExists, readText } from '../fs.js';
import { ackDraft, pendingDrafts } from './journal.js';

export interface ConsolidationResult {
  facts: number;
  patterns: number;
  eventEmitted: boolean;
  acked: string[];
}

function factLine(key: string, title: string): string {
  return `- [draft:${key}] ${title.replace(/\s+/g, ' ').trim()}`;
}

export async function consolidateDrafts(root: string): Promise<ConsolidationResult> {
  const drafts = await pendingDrafts(root);
  if (drafts.length === 0) return { facts: 0, patterns: 0, eventEmitted: false, acked: [] };
  await ensureDir(root);

  const factsFile = path.join(root, 'facts.md');
  const existing = (await pathExists(factsFile)) ? await readText(factsFile) : '';
  const missing = drafts.filter((d) => !existing.includes(`[draft:${d.key}]`));
  if (missing.length > 0) {
    await fs.writeFile(factsFile, existing.trimEnd() + (existing.trim() ? '\n' : '') + missing.map((d) => factLine(d.key, d.title)).join('\n') + '\n', 'utf8');
  }

  const patternsFile = path.join(root, 'patterns.json');
  let patterns: Array<{ id: string; statement: string; tags: string[]; count: number }> = [];
  if (await pathExists(patternsFile)) {
    try { patterns = JSON.parse(await readText(patternsFile)); } catch { patterns = []; }
  }
  let newPatterns = 0;
  for (const d of missing) {
    const id = `draft:${d.key}`;
    if (patterns.some((p) => p.id === id)) continue;
    patterns.push({ id, statement: d.title, tags: d.tags ?? [], count: 1 });
    newPatterns++;
  }
  if (newPatterns > 0) await fs.writeFile(patternsFile, JSON.stringify(patterns, null, 2) + '\n', 'utf8');

  const eventFile = path.join(root, 'sync-events.jsonl');
  const alreadyEmitted = await pathExists(eventFile);
  if (!alreadyEmitted) {
    await fs.writeFile(eventFile, JSON.stringify({ type: 'draft-consolidation', facts: missing.length, patterns: newPatterns, at: new Date().toISOString() }) + '\n', 'utf8');
  }

  const acked: string[] = [];
  for (const d of drafts) { await ackDraft(root, d.key); acked.push(d.key); }
  return { facts: missing.length, patterns: newPatterns, eventEmitted: !alreadyEmitted, acked };
}
