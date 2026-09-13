/**
 * tests/e2e-full/prompts-experiments.test.ts — Q-014 slice 19:
 * prompts experiments / A-B / feedback / exports e2e.
 *
 * experiments_upsert → variants_list → bandit_next → metrics_log_bulk →
 * variants_stats → feedback_log → feedback_validate → ab_report →
 * exports_get → catalog_get → bulk_update → bulk_delete — a full
 * experimentation loop through a real hermetic server.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer, type E2EServer } from './harness.js';

const PROMPT_KEY = 'q014-exp-prompt';

async function seedPrompt(srv: E2EServer) {
  return srv.callTool('prompts_bulk_create', {
    project: 'mcp',
    items: [{
      id: PROMPT_KEY,
      version: '1.0.0',
      type: 'prompt',
      metadata: { title: PROMPT_KEY, domain: 'q014', status: 'active' },
      template: 'Q014 experiment prompt {{item}}',
      variables: ['item'],
      body: 'Q014 experiment prompt',
    }],
  });
}

describe('Q-014 slice 19: experiment loop', () => {
  it('upsert → variants → bandit → metrics → stats → report', async () => {
    const srv = await spawnServer('prompts-exp');
    try {
      expect((await seedPrompt(srv)).env.ok).toBe(true);

      const up = await srv.callTool('prompts_experiments_upsert', {
        project: 'mcp',
        promptKey: PROMPT_KEY,
        variants: ['va', 'vb'],
        params: { epsilon: 0.1 },
      });
      expect(up.isError).toBe(false);
      expect(up.env.ok).toBe(true);

      const variants = await srv.callTool('prompts_variants_list', { project: 'mcp', promptKey: PROMPT_KEY });
      expect(variants.env.ok).toBe(true);
      expect(variants.env.data.variants).toEqual(expect.arrayContaining(['va', 'vb']));

      const pick = await srv.callTool('prompts_bandit_next', { project: 'mcp', promptKey: PROMPT_KEY, epsilon: 0 });
      expect(pick.env.ok).toBe(true);
      expect(['va', 'vb']).toContain(pick.env.data.variantId);
      expect(pick.env.data.id).toBeTruthy();

      const metrics = await srv.callTool('prompts_metrics_log_bulk', {
        project: 'mcp',
        promptKey: PROMPT_KEY,
        items: [
          { requestId: 'r1', variantId: 'va', outcome: { success: true, score: 0.9, latencyMs: 100 } },
          { requestId: 'r2', variantId: 'vb', outcome: { success: false, score: 0.2, latencyMs: 250 } },
        ],
      });
      expect(metrics.isError).toBe(false);
      expect(metrics.env.ok).toBe(true);
      expect(metrics.env.data.count).toBe(2);

      const stats = await srv.callTool('prompts_variants_stats', { project: 'mcp', promptKey: PROMPT_KEY });
      expect(stats.env.ok).toBe(true);
      const rows = stats.env.data.stats as Array<{ variantId: string; trials: number }>;
      expect(rows.find((r) => r.variantId === 'va')?.trials).toBe(1);
      expect(rows.find((r) => r.variantId === 'vb')?.trials).toBe(1);

      const fb = await srv.callTool('prompts_feedback_log', {
        project: 'mcp',
        promptId: PROMPT_KEY,
        version: '1.0.0',
        variant: 'va',
        signals: { thumb: 'up', copied: true },
      });
      expect(fb.isError).toBe(false);
      expect(fb.env.ok).toBe(true);

      const val = await srv.callTool('prompts_feedback_validate', { project: 'mcp' });
      expect(val.env.ok).toBe(true);
      expect(val.env.data.valid).toBe(1);
      expect(val.env.data.invalid).toBe(0);

      const report = await srv.callTool('prompts_ab_report', { project: 'mcp' });
      expect(report.env.ok).toBe(true);
      expect(report.env.data.feedback.thumbs.up).toBe(1);

      const exports = await srv.callTool('prompts_exports_get', { project: 'mcp', type: 'all' });
      expect(exports.env.ok).toBe(true);
      expect(exports.env.data.baseDir).toBeTruthy();

      // Catalog JSON is produced by the async reindex chain (prompts.mjs
      // index→catalog→…), so poll until the prompt lands — env.ok alone is
      // not enough (a stale catalog from a previous step also returns ok).
      const deadline = Date.now() + 20000;
      let catalog: Awaited<ReturnType<E2EServer['callTool']>> | null = null;
      while (Date.now() < deadline) {
        catalog = await srv.callTool('prompts_catalog_get', { project: 'mcp' });
        if (catalog.env.ok && JSON.stringify(catalog.env.data).includes(PROMPT_KEY)) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(catalog?.env.ok).toBe(true);
      expect(JSON.stringify(catalog?.env.data)).toContain(PROMPT_KEY);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 19: prompts bulk update/delete', () => {
  it('bulk_update patches metadata; bulk_delete dryRun then real', async () => {
    const srv = await spawnServer('prompts-bulkupd');
    try {
      expect((await seedPrompt(srv)).env.ok).toBe(true);

      // prompts_list reads the rebuilt catalog — every mutation triggers an
      // async reindex, so poll until the catalog reflects the change.
      const waitList = async (pred: (json: string) => boolean, args: Record<string, unknown> = {}) => {
        const deadline = Date.now() + 30000;
        for (;;) {
          const res = await srv.callTool('prompts_list', { project: 'mcp', ...args });
          const json = JSON.stringify(res.env.data);
          if (res.env.ok && pred(json)) return res;
          if (Date.now() > deadline) return res;
          await new Promise((r) => setTimeout(r, 300));
        }
      };

      // Wait for the initial create to land in the catalog.
      const seeded = await waitList((j) => j.includes(PROMPT_KEY));
      expect(JSON.stringify(seeded.env.data)).toContain(PROMPT_KEY);

      // patch is a shallow top-level merge — metadata must carry all
      // required fields (title/domain/status) or validation fails.
      const upd = await srv.callTool('prompts_bulk_update', {
        project: 'mcp',
        items: [{
          selector: { id: PROMPT_KEY, version: '1.0.0' },
          patch: { metadata: { title: PROMPT_KEY, domain: 'q014', status: 'archived' } },
        }],
      });
      expect(upd.isError).toBe(false);
      expect(upd.env.ok).toBe(true);

      const listArchived = await waitList((j) => j.includes(PROMPT_KEY), { status: 'archived' });
      expect(JSON.stringify(listArchived.env.data)).toContain(PROMPT_KEY);

      const dry = await srv.callTool('prompts_bulk_delete', {
        project: 'mcp',
        items: [{ id: PROMPT_KEY, version: '1.0.0' }],
        dryRun: true,
      });
      expect(dry.env.ok).toBe(true);
      const still = await srv.callTool('prompts_list', { project: 'mcp' });
      expect(JSON.stringify(still.env.data)).toContain(PROMPT_KEY);

      const real = await srv.callTool('prompts_bulk_delete', {
        project: 'mcp',
        items: [{ id: PROMPT_KEY, version: '1.0.0' }],
      });
      expect(real.env.ok).toBe(true);
      const after = await waitList((j) => !j.includes(`"id":"${PROMPT_KEY}"`));
      expect(JSON.stringify(after.env.data)).not.toContain(`"id":"${PROMPT_KEY}"`);
    } finally {
      await srv.close();
    }
  }, 120000);
});
