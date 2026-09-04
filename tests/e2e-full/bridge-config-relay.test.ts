/**
 * tests/e2e-full/bridge-config-relay.test.ts — Q-014 slice 7:
 * markdown import + obsidian roundtrip + config reload + relay status.
 */

import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnServer } from './harness.js';

describe('Q-014 slice 7: markdown import lands in knowledge', () => {
  it('import dir with frontmatter md → searchable doc', async () => {
    const srv = await spawnServer('md-import');
    try {
      const importDir = path.join(srv.tmp, 'import-src');
      await fsp.mkdir(importDir, { recursive: true });
      const uniq = `importedquokka${Date.now().toString(36)}`;
      await fsp.writeFile(
        path.join(importDir, 'note.md'),
        `---\ntitle: Q014 imported note\ntags: [q014]\n---\n\nBody about ${uniq} marsupials.\n`,
        'utf8',
      );

      const imp = await srv.callTool('knowledge_import_markdown', {
        project: 'mcp',
        inputDir: importDir,
        strategy: 'append',
      });
      expect(imp.isError).toBe(false);
      expect(imp.env.ok).toBe(true);

      const found = await srv.callTool('search_knowledge', { query: uniq, project: 'mcp' });
      expect(found.isError).toBe(false);
      expect(JSON.stringify(found.env.data)).toContain('Q014 imported note');
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 7: obsidian export then dry-run import', () => {
  it('export ok → import dryRun ok', async () => {
    const srv = await spawnServer('obsidian-rt');
    try {
      await srv.callTool('tasks_create', { project: 'mcp', title: 'Q014 obsidian task' });

      const exp = await srv.callTool('obsidian_export_project', {
        project: 'mcp',
        knowledge: true,
        tasks: true,
        prompts: false,
        strategy: 'merge',
      });
      expect(exp.isError).toBe(false);
      expect(exp.env.ok).toBe(true);

      const imp = await srv.callTool('obsidian_import_project', {
        project: 'mcp',
        knowledge: true,
        tasks: false,
        prompts: false,
        strategy: 'merge',
        dryRun: true,
      });
      expect(imp.isError).toBe(false);
      expect(imp.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 7: config reload + relay status shapes', () => {
  it('config_reload and relay_status answer ok', async () => {
    const srv = await spawnServer('cfg-relay', { RELAY_ENABLED: '1' });
    try {
      const reload = await srv.callTool('config_reload', {});
      expect(reload.isError).toBe(false);
      expect(reload.env.ok).toBe(true);
      expect(typeof reload.env.data.reloaded).toBe('boolean');

      const relay = await srv.callTool('relay_status', {});
      expect(relay.isError).toBe(false);
      expect(relay.env.ok).toBe(true);
    } finally {
      await srv.close();
    }
  }, 60000);
});
