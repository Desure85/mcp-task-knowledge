import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Helper to import fresh copy of a module with current env
async function importFresh(specifier) {
    // Reset ESM module cache in Vitest
    vi.resetModules();
    // Import without query string to avoid esbuild loader errors
    const m = await import(specifier);
    return m;
}
const CONFIG_PATH = '../config.ts';
// Preserve original env
const ENV_SNAPSHOT = { ...process.env };
beforeEach(() => {
    // Reset env to a clean baseline before each test
    process.env = { ...ENV_SNAPSHOT };
});
afterEach(() => {
    // Restore env after tests
    process.env = { ...ENV_SNAPSHOT };
});
describe('config.ts validations and fallbacks', () => {
    it('throws if DATA_DIR is not set at module init', async () => {
        delete process.env.DATA_DIR;
        // OBSIDIAN_VAULT_ROOT can be set or not; DATA_DIR error should trigger first
        const err = await importFresh(CONFIG_PATH).then(() => null).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(String(err?.message || err)).toContain('DATA_DIR must be set');
    });
    it('loadConfig uses default OBSIDIAN_VAULT_ROOT=/data/obsidian when not set', async () => {
        // Provide minimal DATA_DIR so module loads
        process.env.DATA_DIR = '/tmp/mcp-data';
        delete process.env.OBSIDIAN_VAULT_ROOT;
        const cfgMod = await importFresh(CONFIG_PATH);
        const cfg = cfgMod.loadConfig();
        expect(cfg.obsidian.vaultRoot).toBe('/data/obsidian');
    });
    it('falls back to EMBEDDINGS_MODE=none when ONNX params are missing', async () => {
        process.env.DATA_DIR = '/tmp/mcp-data';
        process.env.OBSIDIAN_VAULT_ROOT = '/data/obsidian';
        process.env.EMBEDDINGS_MODE = 'onnx-gpu';
        delete process.env.EMBEDDINGS_MODEL_PATH;
        delete process.env.EMBEDDINGS_DIM;
        // Silence warnings for this test
        const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const cfgMod = await importFresh(CONFIG_PATH);
        const cfg = cfgMod.loadConfig();
        expect(cfg.embeddings.mode).toBe('none');
        spyWarn.mockRestore();
    });
    it('catalog remote without baseUrl falls back to embedded with warning', async () => {
        process.env.DATA_DIR = '/tmp/mcp-data';
        process.env.OBSIDIAN_VAULT_ROOT = '/data/obsidian';
        process.env.CATALOG_MODE = 'remote';
        delete process.env.CATALOG_URL;
        delete process.env.CATALOG_REMOTE_BASE_URL;
        const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const cfgMod = await importFresh(CONFIG_PATH);
        const catalogCfg = cfgMod.loadCatalogConfig();
        expect(catalogCfg.mode).toBe('embedded');
        expect(catalogCfg.prefer).toBe('embedded');
        expect(catalogCfg.embedded.enabled).toBe(true);
        spyWarn.mockRestore();
    });
});
