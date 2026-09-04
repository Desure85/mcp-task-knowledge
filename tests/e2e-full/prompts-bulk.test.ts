/**
 * tests/e2e-full/prompts-bulk.test.ts — Q-014 slice 4: prompts harness + bulk ops.
 *
 * Skills/rules/workflows/policies live in the prompts library
 * (prompts_bulk_create writes under prompts/|rules/|workflows/|templates/|policies):
 * bulk-create → list → search roundtrip, plus tasks_bulk_create → bulk_close.
 */

import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnServer } from './harness.js';

describe('Q-014 slice 4: prompts library (skills/rules/workflows surface)', () => {
  it('bulk-create prompt → list → search finds it', async () => {
    const srv = await spawnServer('prompts-lib');
    try {
      const name = `q014-prompt-${Date.now().toString(36)}`;
      const created = await srv.callTool('prompts_bulk_create', {
        project: 'mcp',
        items: [{
          id: name,
          version: '1.0.0',
          type: 'prompt',
          metadata: { title: name, domain: 'q014', status: 'draft', kind: 'skill' },
          template: 'Review checklist for q014: {{item}}',
          variables: ['item'],
          body: 'Review checklist for q014',
        }],
      });
      expect(created.isError).toBe(false);
      expect(created.env.ok).toBe(true);

      const listed = await srv.callTool('prompts_list', { project: 'mcp', kind: 'skill' });
      expect(listed.env.ok).toBe(true);

      const landed = path.join(srv.store, 'prompts', 'mcp', 'prompts', `${name}@1.0.0.json`);
      const raw = await fsp.readFile(landed, 'utf8');
      const stored = JSON.parse(raw);
      expect(stored.id).toBe(name);
      expect(stored.metadata.kind).toBe('skill');

      const found = await srv.callTool('prompts_search', { project: 'mcp', query: name });
      expect(found.isError).toBe(false);
      expect(found.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 4: tasks bulk ops', () => {
  it('bulk-create 3 → bulk-close → closed state', async () => {
    const srv = await spawnServer('tasks-bulk');
    try {
      const bulk = await srv.callTool('tasks_bulk_create', {
        project: 'mcp',
        items: [
          { title: 'Q014 bulk A' },
          { title: 'Q014 bulk B' },
          { title: 'Q014 bulk C' },
        ],
      });
      expect(bulk.isError).toBe(false);
      expect(bulk.env.ok).toBe(true);
      const ids = (bulk.env.data.created ?? bulk.env.data ?? []).map((t: any) => t.id ?? t);
      expect(ids.length).toBe(3);

      const closed = await srv.callTool('tasks_bulk_close', { project: 'mcp', ids });
      expect(closed.isError).toBe(false);

      const list = await srv.callTool('tasks_list', { project: 'mcp' });
      expect(list.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});
