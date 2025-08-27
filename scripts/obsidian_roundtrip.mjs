// E2E roundtrip smoke for Obsidian export -> import using a temporary vault and store
// Safe: writes only under .tmp/, does not touch real /data/obsidian

import fs from 'node:fs/promises';
import path from 'node:path';

async function ensureEmptyDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function main() {
  try {
    const cwd = process.cwd();
    const TMP_DIR = path.resolve(cwd, '.tmp');
    const VAULT_ROOT = path.join(TMP_DIR, 'obsidian');
    const STORE_DIR = path.join(TMP_DIR, 'store');
    const PROJECT = process.env.PROJECT || 'mcp';

    // Isolate all IO under .tmp/
    await ensureEmptyDir(VAULT_ROOT);
    await ensureEmptyDir(STORE_DIR);

    process.env.OBSIDIAN_VAULT_ROOT = VAULT_ROOT;
    process.env.DATA_DIR = STORE_DIR;

    // Import modules from built dist
    const exp = await import('../dist/obsidian/export.js');
    const imp = await import('../dist/obsidian/import.js');
    const tasks = await import('../dist/storage/tasks.js');
    const kb = await import('../dist/storage/knowledge.js');

    // Seed minimal data into the fresh store so export has content
    const seedDoc = await kb.createDoc({
      project: PROJECT,
      title: 'ROUNDTRIP_DOC',
      content: '# Roundtrip Doc\n\nThis is a seed doc for roundtrip test.',
      type: 'overview',
    });
    // Create parent-child tasks so export produces a folder with INDEX.md
    const parentTask = await tasks.createTask({
      project: PROJECT,
      title: 'ROUNDTRIP_PARENT',
      description: 'Parent for roundtrip test',
    });
    const childTask = await tasks.createTask({
      project: PROJECT,
      title: 'ROUNDTRIP_CHILD',
      description: 'Child for roundtrip test',
      parentId: parentTask.id,
    });

    // 1) Export with replace
    const er = await exp.exportProjectToVault(PROJECT, { strategy: 'replace' });
    if (!er || er.vaultRoot !== VAULT_ROOT) throw new Error('vaultRoot mismatch');

    const projectRoot = path.join(VAULT_ROOT, PROJECT);
    const knowledgeDir = path.join(projectRoot, 'Knowledge');
    const tasksDir = path.join(projectRoot, 'Tasks');
    const indexPath = path.join(projectRoot, 'INDEX.md');

    for (const reqPath of [projectRoot, knowledgeDir, tasksDir, indexPath]) {
      const ok = await pathExists(reqPath);
      if (!ok) throw new Error(`Missing after export: ${reqPath}`);
    }

    // 2) Import with replace (fresh apply)
    const ir = await imp.importProjectFromVault(PROJECT, { strategy: 'replace' });
    if (!ir || ir.vaultRoot !== VAULT_ROOT) throw new Error('import vaultRoot mismatch');

    // 3) Validate storage has items
    const docs = await kb.listDocs({ project: PROJECT });
    const tlist = await tasks.listTasks({ project: PROJECT });
    if (!Array.isArray(docs) || docs.length === 0) throw new Error('No knowledge docs imported');
    if (!Array.isArray(tlist) || tlist.length === 0) throw new Error('No tasks imported');

    // 4) Basic structural assertions on files vs counts (best-effort)
    const hasKnowledgeEntries = (await fs.readdir(knowledgeDir)).length > 0;
    const hasTaskEntries = (await fs.readdir(tasksDir)).length > 0;
    if (!hasKnowledgeEntries) throw new Error('Knowledge folder empty');
    if (!hasTaskEntries) throw new Error('Tasks folder empty');

    console.log('OBSIDIAN_ROUNDTRIP_OK', {
      project: PROJECT,
      vaultRoot: VAULT_ROOT,
      knowledgeExported: er.knowledgeCount,
      tasksExported: er.tasksCount,
      knowledgeImported: ir.knowledgeImported,
      tasksImported: ir.tasksImported,
      docsInStore: docs.length,
      tasksInStore: tlist.length,
    });
    process.exit(0);
  } catch (e) {
    console.error('OBSIDIAN_ROUNDTRIP_FAIL', e?.stack || e?.message || e);
    process.exit(1);
  }
}

main();
