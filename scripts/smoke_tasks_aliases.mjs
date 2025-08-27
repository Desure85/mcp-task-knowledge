// e2e smoke to ensure removed alias and single CLI tools are ABSENT in built MCP server bundle
// This script runs inside the MCP container and validates that alias tools
// `tasks_reparent` and `tasks_move_subtree` are NOT registered in /app/dist/index.js.
// It also asserts that bulk tools are present, while single tools are not.

import fs from 'node:fs/promises';

(async () => {
  try {
    const APP_DIR = process.env.APP_DIR || '/app';
    const path = `${APP_DIR}/dist/index.js`;
    const buf = await fs.readFile(path, 'utf8');

    // Aliases must be absent
    const hasReparentAlias = buf.includes('"tasks_reparent"') || buf.includes("'tasks_reparent'");
    const hasMoveSubtreeAlias = buf.includes('"tasks_move_subtree"') || buf.includes("'tasks_move_subtree'");
    if (hasReparentAlias) {
      throw new Error('Removed alias tool "tasks_reparent" is present in dist/index.js');
    }
    if (hasMoveSubtreeAlias) {
      throw new Error('Removed alias tool "tasks_move_subtree" is present in dist/index.js');
    }

    // Single (base) tools must be absent after refactor
    const hasBaseReparent = buf.includes('"reparent_task"') || buf.includes("'reparent_task'");
    const hasBaseMoveSubtree = buf.includes('"move_subtree_task"') || buf.includes("'move_subtree_task'");
    if (hasBaseReparent) {
      throw new Error('Removed single tool "reparent_task" is present in dist/index.js');
    }
    if (hasBaseMoveSubtree) {
      throw new Error('Removed single tool "move_subtree_task" is present in dist/index.js');
    }

    // Bulk tools must be present
    const bulkMust = [
      'tasks_bulk_update',
      'tasks_list',
      'tasks_tree',
      'tasks_get',
      'knowledge_bulk_create',
      'knowledge_list',
      'knowledge_tree',
      'knowledge_get',
    ];
    for (const name of bulkMust) {
      const present = buf.includes(`"${name}"`) || buf.includes(`'${name}'`);
      if (!present) throw new Error(`Expected bulk tool not found: ${name}`);
    }

    console.log('TASKS_ALIASES_SMOKE_OK', {
      aliasesPresent: { tasks_reparent: hasReparentAlias, tasks_move_subtree: hasMoveSubtreeAlias },
      singlePresent: { reparent_task: hasBaseReparent, move_subtree_task: hasBaseMoveSubtree },
      bulkChecked: true,
    });
    process.exit(0);
  } catch (e) {
    console.error('TASKS_ALIASES_SMOKE_FAIL', e?.stack || e?.message || e);
    process.exit(1);
  }
})();
