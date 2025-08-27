// Offline smoke test for embeddings (CPU image)
// Usage inside container: node /tmp/smoke_embeddings.mjs

(async () => {
  try {
    const APP_DIR = process.env.APP_DIR || '/app';
    const mod = await import(`${APP_DIR}/dist/search/vector.js`);
    // Prefer helper to respect EMBEDDINGS_MODE
    const getAdapter = mod.getVectorAdapter || (async () => new mod.OnnxVectorAdapter(768));
    const adapter = await getAdapter();
    // Allow graceful skip when embeddings are disabled
    let mode = (process.env.EMBEDDINGS_MODE || '').toLowerCase();
    try {
      if ((!mode || mode === '') && APP_DIR) {
        const cfgMod = await import(`${APP_DIR}/dist/config.js`).catch(() => null);
        if (cfgMod?.loadConfig) {
          const cfg = cfgMod.loadConfig();
          mode = String(cfg?.embeddings?.mode || '').toLowerCase();
        }
      }
    } catch {}
    if (!adapter) {
      if (mode === 'none') {
        console.log('EMBEDDINGS_DISABLED_SKIP');
        process.exit(0);
      }
      console.error('No vector adapter is enabled. Check EMBEDDINGS_MODE.');
      process.exit(2);
    }

    const items = [
      { id: '1', text: 'Привет мир', item: { i: 1 } },
      { id: '2', text: 'Hello world', item: { i: 2 } },
      { id: '3', text: 'Добро пожаловать', item: { i: 3 } },
    ];

    const res = await adapter.search('мир', items, { limit: 3 });
    console.log(JSON.stringify(res, null, 2));
    // Workaround: some ORT GPU builds may crash on process teardown if env isn't released
    // Explicitly terminate after output to avoid Node's module destructor path.
    setImmediate(() => process.exit(0));
  } catch (e) {
    console.error('SMOKE_EMBEDDINGS_ERR', e?.stack || e?.message || e);
    process.exit(1);
  }
})();

