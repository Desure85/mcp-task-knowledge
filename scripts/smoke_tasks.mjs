// Smoke test for tasks storage logic inside the MCP container
// This does not use the MCP client; it validates storage and hierarchy operations end-to-end on disk.

(async () => {
  try {
    // Use built JS modules from dist (support both container and local CI)
    const APP_DIR = process.env.APP_DIR || '/app';
    const tasks = await import(`${APP_DIR}/dist/storage/tasks.js`);

    const project = process.env.PROJECT || 'mcp';

    // 1) Create a small tree A -> B -> C
    const A = await tasks.createTask({ project, title: 'SMOKE_A' });
    const B = await tasks.createTask({ project, title: 'SMOKE_B', parentId: A.id });
    const C = await tasks.createTask({ project, title: 'SMOKE_C', parentId: B.id });

    // 2) Reparent B to root (null), ensure C stays under B
    const B1 = await tasks.updateTask(project, B.id, { parentId: undefined });
    if (!B1 || B1.parentId !== undefined) throw new Error('Reparent to root failed');
    const C1 = await tasks.getTask(project, C.id);
    if (!C1 || C1.parentId !== B.id) throw new Error('Child link lost after reparent');

    // 3) Move subtree: B under A again (equivalent to setting parentId)
    const B2 = await tasks.updateTask(project, B.id, { parentId: A.id });
    if (!B2 || B2.parentId !== A.id) throw new Error('Move subtree failed');

    // 4) Archive/unarchive A
    const Aarch = await tasks.archiveTask(project, A.id);
    if (!Aarch || !Aarch.archived) throw new Error('Archive failed');
    const Aun = await tasks.restoreTask(project, A.id);
    if (!Aun || Aun.archived) throw new Error('Unarchive failed');

    // 5) List tree (exclude archived by default)
    const tree = await tasks.listTasksTree({ project });
    if (!Array.isArray(tree) || tree.length === 0) throw new Error('Tree is empty');

    // 6) Archived filtering check: create archived root and ensure it's excluded by default
    const AR = await tasks.createTask({ project, title: 'SMOKE_ARCHIVED_ROOT' });
    await tasks.archiveTask(project, AR.id);
    const treeNoArch = await tasks.listTasksTree({ project });
    const hasAR = JSON.stringify(treeNoArch).includes(AR.id);
    if (hasAR) throw new Error('Archived root should be excluded by default');
    const treeWithArch = await tasks.listTasksTree({ project, includeArchived: true });
    const hasAR2 = JSON.stringify(treeWithArch).includes(AR.id);
    if (!hasAR2) throw new Error('Archived root should be included with includeArchived:true');

    console.log('TASKS_SMOKE_OK', { project, roots: tree.length });
    process.exit(0);
  } catch (e) {
    console.error('TASKS_SMOKE_FAIL', e?.stack || e?.message || e);
    process.exit(1);
  }
})();
