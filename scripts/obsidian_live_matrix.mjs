// Live matrix verification for Obsidian export filters (dryRun vs actual)
// Safe: uses .tmp/ only, does not touch real /data/obsidian

import fs from 'node:fs/promises';
import path from 'node:path';

async function ensureEmptyDir(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function seedData(PROJECT, tasks, kb) {
  // knowledge
  await kb.createDoc({
    project: PROJECT,
    title: 'MATRIX_DOC_ALPHA',
    content: '# Matrix Alpha\nTags: alpha,beta',
    type: 'overview',
    tags: ['alpha', 'beta'],
  });
  await kb.createDoc({
    project: PROJECT,
    title: 'MATRIX_DOC_SECRET',
    content: '# Matrix Secret\nTags: secret',
    type: 'note',
    tags: ['secret'],
  });

  // tasks: diverse status/priority for filters
  const t1 = await tasks.createTask({ project: PROJECT, title: 'MATRIX_TASK_P1', description: 'alpha task', status: 'in_progress', priority: 'high', tags: ['alpha'] });
  await tasks.createTask({ project: PROJECT, title: 'MATRIX_TASK_P2', description: 'secret task', status: 'closed', priority: 'low', parentId: t1.id, tags: ['secret'] });
}

async function runScenario(PROJECT, VAULT_ROOT, label, exp, options) {
  // Plan (dryRun)
  const plan = await exp.planExportProjectToVault(PROJECT, options);
  // Actual export
  const res = await exp.exportProjectToVault(PROJECT, options);
  const summary = {
    label,
    options,
    plan: { knowledge: plan.knowledgeCount, tasks: plan.tasksCount },
    export: { knowledge: res.knowledgeCount, tasks: res.tasksCount },
    vaultRoot: res.vaultRoot,
  };
  const ok = summary.plan.knowledge === summary.export.knowledge && summary.plan.tasks === summary.export.tasks;
  return { ok, summary };
}

async function main() {
  const cwd = process.cwd();
  const TMP_DIR = path.resolve(cwd, '.tmp');
  const VAULT_ROOT = path.join(TMP_DIR, 'obsidian_matrix');
  const STORE_DIR = path.join(TMP_DIR, 'store_matrix');
  const PROJECT = process.env.PROJECT || 'mcp';

  await ensureEmptyDir(VAULT_ROOT);
  await ensureEmptyDir(STORE_DIR);

  process.env.OBSIDIAN_VAULT_ROOT = VAULT_ROOT;
  process.env.DATA_DIR = STORE_DIR;

  // Import built modules
  const exp = await import('../dist/obsidian/export.js');
  const tasks = await import('../dist/storage/tasks.js');
  const kb = await import('../dist/storage/knowledge.js');

  // Seed minimal dataset
  await seedData(PROJECT, tasks, kb);

  // Ensure project folders will be present after export
  const projectRoot = path.join(VAULT_ROOT, PROJECT);

  const scenarios = [
    {
      label: 'A: includeTags=[alpha], excludeTags=[], includeArchived=false, keepOrphans=true, strategy=replace',
      options: { strategy: 'replace', confirm: true, includeTags: ['alpha'], excludeTags: [], includeArchived: false, keepOrphans: true },
    },
    {
      label: 'B: includeTags=[alpha], excludeTags=[secret], includeArchived=true, keepOrphans=false, strategy=merge',
      options: { strategy: 'merge', includeTags: ['alpha'], excludeTags: ['secret'], includeArchived: true, keepOrphans: false },
    },
  ];

  const results = [];
  for (const sc of scenarios) {
    // Clean vault between scenarios if replace
    if (sc.options.strategy === 'replace') {
      await ensureEmptyDir(VAULT_ROOT);
    }
    const r = await runScenario(PROJECT, VAULT_ROOT, sc.label, exp, sc.options);
    // Basic filesystem checks
    const indexPath = path.join(projectRoot, 'INDEX.md');
    const hasIndex = await pathExists(indexPath);
    results.push({ ...r, hasIndex });
  }

  const allOk = results.every(r => r.ok && r.hasIndex);
  const out = { project: PROJECT, vaultRoot: VAULT_ROOT, scenarios: results };
  if (!allOk) {
    console.error('OBSIDIAN_MATRIX_FAIL', JSON.stringify(out, null, 2));
    process.exit(1);
  } else {
    console.log('OBSIDIAN_MATRIX_OK', JSON.stringify(out, null, 2));
    process.exit(0);
  }
}

main().catch(e => { console.error('OBSIDIAN_MATRIX_FAIL', e?.stack || e?.message || e); process.exit(1); });
