// Smoke test for knowledge storage logic inside the MCP container
// Validates create -> read -> update -> archive/unarchive -> list

(async () => {
  try {
    const APP_DIR = process.env.APP_DIR || '/app';
    const k = await import(`${APP_DIR}/dist/storage/knowledge.js`);
    const project = process.env.PROJECT || 'mcp';

    // 1) Create doc
    const doc = await k.createDoc({ project, title: 'SMOKE_DOC', content: '# Smoke\nBody', tags: ['smoke'] });
    if (!doc?.id) throw new Error('createDoc failed');

    // 2) Read doc
    const rd = await k.readDoc(project, doc.id);
    if (!rd || rd.title !== 'SMOKE_DOC') throw new Error('readDoc failed');

    // 3) Update doc
    const up = await k.updateDoc(project, doc.id, { title: 'SMOKE_DOC_UPD', content: '# Smoke\nUpdated' });
    if (!up || up.title !== 'SMOKE_DOC_UPD' || !up.content.includes('Updated')) throw new Error('updateDoc failed');

    // 4) Archive/unarchive
    const arc = await k.archiveDoc(project, doc.id);
    if (!arc || !arc.archived) throw new Error('archiveDoc failed');
    const un = await k.restoreDoc(project, doc.id);
    if (!un || un.archived) throw new Error('restoreDoc failed');

    // 5) List docs (skip trashed by default)
    const list = await k.listDocs({ project });
    const found = list.find(d => d.id === doc.id);
    if (!found) throw new Error('listDocs did not return created doc');

    // 6) Detachment scenario: A (parent) -> B (child) then detach B to root via parentId:null
    const A = await k.createDoc({ project, title: 'SMOKE_K_TREE_A', content: '# A' });
    const B = await k.createDoc({ project, title: 'SMOKE_K_TREE_B', content: '# B', parentId: A.id });
    if (!A?.id || !B?.id) throw new Error('Failed to create A/B docs');

    const B1 = await k.updateDoc(project, B.id, { parentId: null });
    if (!B1) throw new Error('Detachment update failed');
    const Bcheck = await k.readDoc(project, B.id);
    if (!Bcheck || !(Bcheck.parentId == null)) throw new Error('Detachment did not set parentId to null/undefined');

    // Build knowledge tree locally: falsy parentId => root
    const list2 = await k.listDocs({ project });
    const byId = new Map(list2.map(d => [d.id, { ...d, children: [] }]));
    const roots = [];
    for (const m of byId.values()) {
      if (m.parentId && byId.has(m.parentId)) {
        byId.get(m.parentId).children.push(m);
      } else {
        roots.push(m);
      }
    }
    const isBRoot = roots.some(r => r.id === B.id);
    if (!isBRoot) throw new Error('Detachment tree check failed: B is not at root');

    console.log('KNOWLEDGE_SMOKE_OK', { project, count: list.length });
    process.exit(0);
  } catch (e) {
    console.error('KNOWLEDGE_SMOKE_FAIL', e?.stack || e?.message || e);
    process.exit(1);
  }
})();
