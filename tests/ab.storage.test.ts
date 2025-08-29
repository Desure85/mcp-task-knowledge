import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-ab-storage');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}
async function mkdirp(p: string) {
  await fsp.mkdir(p, { recursive: true });
}
async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

describe('A/B storage helpers', () => {
  let storage: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await mkdirp(STORE);
    process.env.DATA_DIR = STORE;
    process.env.CURRENT_PROJECT = PROJECT;
    storage = await import('../src/ab-testing/storage.js');
  }, 20000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('listBuildVariants discovers matching builds', async () => {
    const buildsDir = path.join(STORE, 'prompts', PROJECT, 'exports', 'builds');
    await mkdirp(buildsDir);
    // create several build files
    await fsp.writeFile(path.join(buildsDir, 'MCP-PROMPT-ANA-001.json'), '{}');
    await fsp.writeFile(path.join(buildsDir, 'MCP-PROMPT-ANA-001.v2.json'), '{}');
    await fsp.writeFile(path.join(buildsDir, 'MCP-PROMPT-ANA-001--hint.json'), '{}');
    await fsp.writeFile(path.join(buildsDir, 'OTHER.json'), '{}');

    const list: string[] = await storage.listBuildVariants(PROJECT, 'MCP-PROMPT-ANA-001');
    expect(list.sort()).toEqual(['MCP-PROMPT-ANA-001', 'MCP-PROMPT-ANA-001.v2', 'MCP-PROMPT-ANA-001--hint'].sort());
  });

  it('appendEvents and updateAggregates maintain aggregates', async () => {
    const promptKey = 'MCP-PROMPT-ANA-002';
    const events = [
      { ts: new Date().toISOString(), requestId: 'r1', variantId: 'A', outcome: { success: true, score: 0.8, latencyMs: 120 } },
      { ts: new Date().toISOString(), requestId: 'r2', variantId: 'A', outcome: { success: false, score: 0.2, latencyMs: 200 } },
      { ts: new Date().toISOString(), requestId: 'r3', variantId: 'B', outcome: { success: true, score: 0.9, latencyMs: 150 } },
    ];
    await storage.appendEvents(PROJECT, promptKey, events);
    const aggr = await storage.updateAggregates(PROJECT, promptKey, events);
    expect(aggr['A']).toBeTruthy();
    expect(aggr['B']).toBeTruthy();
    expect(aggr['A'].trials).toBe(2);
    expect(aggr['A'].successes).toBe(1);
    expect(aggr['B'].trials).toBe(1);
    expect(aggr['B'].successes).toBe(1);

    const aggr2 = await storage.readAggregates(PROJECT, promptKey);
    expect(aggr2['A'].trials).toBe(2);
  });
});
