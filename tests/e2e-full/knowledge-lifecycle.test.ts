/**
 * tests/e2e-full/knowledge-lifecycle.test.ts — Q-014 slice 17:
 * knowledge lifecycle + import/export e2e.
 *
 * bulk_update/archive/trash/restore/delete_permanent, tree view,
 * export_single/bundle/markdown, import_single, multimodal text import,
 * two-stage search — all through a real hermetic server.
 */

import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnServer } from './harness.js';

describe('Q-014 slice 17: knowledge bulk lifecycle', () => {
  it('bulk_update → tree → archive → trash → restore → delete_permanent', async () => {
    const srv = await spawnServer('kb-lifecycle');
    try {
      const bulk = await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [
          { title: 'Q014 kb-life A', content: 'alpha content', tags: ['q014life'] },
          { title: 'Q014 kb-life B', content: 'beta content', tags: ['q014life'] },
        ],
      });
      expect(bulk.env.ok).toBe(true);
      const ids = (bulk.env.data.created ?? []).map((d: { id: string }) => d.id);
      expect(ids.length).toBe(2);

      const upd = await srv.callTool('knowledge_bulk_update', {
        project: 'mcp',
        items: [{ id: ids[0], title: 'Q014 kb-life A renamed' }],
      });
      expect(upd.isError).toBe(false);
      expect(upd.env.ok).toBe(true);
      const got = await srv.callTool('knowledge_get', { project: 'mcp', id: ids[0] });
      expect(got.env.data.title).toBe('Q014 kb-life A renamed');

      const tree = await srv.callTool('knowledge_tree', { project: 'mcp', includeArchived: true });
      expect(tree.env.ok).toBe(true);
      expect(JSON.stringify(tree.env.data)).toContain('Q014 kb-life');

      await srv.callTool('knowledge_bulk_archive', { project: 'mcp', ids: [ids[0]] });
      const visible = await srv.callTool('knowledge_list', { project: 'mcp' });
      expect(JSON.stringify(visible.env.data)).not.toContain('Q014 kb-life A renamed');

      await srv.callTool('knowledge_bulk_trash', { project: 'mcp', ids: [ids[1]] });
      const afterTrash = await srv.callTool('knowledge_list', { project: 'mcp', tag: 'q014life' });
      expect(JSON.stringify(afterTrash.env.data)).not.toContain('Q014 kb-life B');

      const restored = await srv.callTool('knowledge_bulk_restore', { project: 'mcp', ids: [ids[1]] });
      expect(restored.env.ok).toBe(true);
      const afterRestore = await srv.callTool('knowledge_list', { project: 'mcp', tag: 'q014life' });
      expect(JSON.stringify(afterRestore.env.data)).toContain('Q014 kb-life B');

      const gone = await srv.callTool('knowledge_bulk_delete_permanent', { project: 'mcp', ids: [ids[0]] });
      expect(gone.isError).toBe(false);
      const getDeleted = await srv.callTool('knowledge_get', { project: 'mcp', id: ids[0] });
      expect(getDeleted.env.ok).not.toBe(true);
    } finally {
      await srv.close();
    }
  }, 120000);
});

describe('Q-014 slice 17: knowledge import/export surface', () => {
  it('export_single → export_bundle → export_markdown → import_single roundtrip', async () => {
    const srv = await spawnServer('kb-io');
    try {
      const bulk = await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [{ title: 'Q014 export doc', content: 'exportable body', tags: ['q014exp'] }],
      });
      const docId = bulk.env.data.created[0].id as string;

      const single = await srv.callTool('knowledge_export_single', { project: 'mcp', id: docId });
      expect(single.env.ok).toBe(true);
      expect(single.env.data.markdown).toContain('Q014 export doc');

      const singleSys = await srv.callTool('knowledge_export_single', {
        project: 'mcp',
        id: docId,
        includeSystemFields: true,
      });
      expect(singleSys.env.data.markdown).toContain(docId);

      const bundle = await srv.callTool('knowledge_export_bundle', { project: 'mcp', tag: 'q014exp' });
      expect(bundle.env.ok).toBe(true);
      expect(JSON.stringify(bundle.env.data)).toContain('Q014 export doc');

      // export_markdown: dryRun lists files, real run writes them under tmp.
      const outDir = path.join(srv.tmp, 'export-md');
      const dry = await srv.callTool('knowledge_export_markdown', {
        project: 'mcp',
        outputDir: outDir,
        tag: 'q014exp',
        dryRun: true,
      });
      expect(dry.env.ok).toBe(true);
      expect(dry.env.data.count).toBeGreaterThanOrEqual(1);

      const real = await srv.callTool('knowledge_export_markdown', {
        project: 'mcp',
        outputDir: outDir,
        tag: 'q014exp',
      });
      expect(real.env.ok).toBe(true);
      const written = real.env.data.files?.[0]?.file as string;
      const onDisk = await fsp.readFile(path.join(outDir, written), 'utf8');
      expect(onDisk).toContain('exportable body');

      const imp = await srv.callTool('knowledge_import_single', {
        project: 'mcp',
        markdown: `---\ntitle: Q014 imported single\ntags: [q014imp]\n---\n\nSingle-imported body.\n`,
      });
      expect(imp.isError).toBe(false);
      expect(imp.env.ok).toBe(true);
      const got = await srv.callTool('knowledge_get', { project: 'mcp', id: imp.env.data.id });
      expect(got.env.data.title).toBe('Q014 imported single');

      // Path safety: relative outputDir rejected.
      const badDir = await srv.callTool('knowledge_export_markdown', {
        project: 'mcp',
        outputDir: 'relative/out',
      });
      expect(badDir.isError).toBe(true);
      expect(badDir.env.ok).toBe(false);
    } finally {
      await srv.close();
    }
  }, 120000);

  it('multimodal text import + two-stage search', async () => {
    const srv = await spawnServer('kb-multimodal');
    const rare = `mmquokka${Date.now().toString(36)}`;
    try {
      // File must live inside DATA_DIR — drop it into the store root.
      await fsp.writeFile(path.join(srv.store, 'notes.txt'), `Notes about ${rare} ingestion chunks.`, 'utf8');

      const mm = await srv.callTool('knowledge_import_multimodal', {
        project: 'mcp',
        filePath: 'notes.txt',
        type: 'text',
      });
      expect(mm.isError).toBe(false);
      expect(mm.env.ok).toBe(true);
      expect(mm.env.data.returnedChunks).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(mm.env.data.chunks)).toContain(rare);

      // Path traversal guard: escaping DATA_DIR is rejected.
      const escape = await srv.callTool('knowledge_import_multimodal', {
        project: 'mcp',
        filePath: '../outside.txt',
        type: 'text',
      });
      expect(escape.isError).toBe(true);
      expect(escape.env.ok).toBe(false);

      await srv.callTool('knowledge_bulk_create', {
        project: 'mcp',
        items: [{ title: 'Q014 two-stage doc', content: `Long document about ${rare} marsupials and reranking.`.repeat(20), tags: ['q014ts'] }],
      });
      const ts = await srv.callTool('mcp1_search_knowledge_two_stage', {
        project: 'mcp',
        query: rare,
        limit: 5,
      });
      expect(ts.isError).toBe(false);
      expect(ts.env.ok).toBe(true);
      expect(JSON.stringify(ts.env.data)).toContain('Q014 two-stage doc');
    } finally {
      await srv.close();
    }
  }, 120000);
});
