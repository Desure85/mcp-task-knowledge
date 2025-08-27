import path from 'node:path';
import fs from 'node:fs';
// Helper: read JSON config from path
function readJsonConfig(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}
// Resolve base config source: CLI --config path, MCP_CONFIG_JSON, then ENV
function getCliArg(name) {
    const idx = process.argv.indexOf(name);
    if (idx >= 0 && idx + 1 < process.argv.length)
        return process.argv[idx + 1];
    return undefined;
}
const cliConfigPath = getCliArg('--config');
let fileConfig = {};
if (cliConfigPath) {
    try {
        fileConfig = readJsonConfig(cliConfigPath);
    }
    catch (e) {
        console.warn(`[config] Failed to read --config ${cliConfigPath}:`, e);
    }
}
else if (process.env.MCP_CONFIG_JSON) {
    try {
        fileConfig = JSON.parse(process.env.MCP_CONFIG_JSON);
    }
    catch (e) {
        console.warn('[config] Failed to parse MCP_CONFIG_JSON:', e);
    }
}
const DATA_DIR_CFG = fileConfig.dataDir;
const DATA_DIR_ENV = process.env.DATA_DIR;
const DATA_DIR_RESOLVED = DATA_DIR_CFG || DATA_DIR_ENV;
if (!DATA_DIR_RESOLVED) {
    throw new Error('DATA_DIR must be set (via config file dataDir or environment)');
}
export const DATA_DIR = DATA_DIR_RESOLVED;
// Support for separate task and knowledge directories via environment variables
const MCP_TASK_DIR_ENV = process.env.MCP_TASK_DIR;
const MCP_KNOWLEDGE_DIR_ENV = process.env.MCP_KNOWLEDGE_DIR;
// Support both modern layout: DATA_DIR/{tasks,knowledge}
// and legacy layout: DATA_DIR/mcp/{tasks,knowledge}
function pickDir(envOverride, primary, legacy) {
    if (envOverride && envOverride.trim().length > 0)
        return envOverride;
    try {
        const hasPrimary = fs.existsSync(primary);
        const hasLegacy = fs.existsSync(legacy);
        if (hasPrimary)
            return primary;
        if (!hasPrimary && hasLegacy)
            return legacy;
    }
    catch { }
    return primary;
}
export const TASKS_DIR = pickDir(MCP_TASK_DIR_ENV, path.join(DATA_DIR, 'tasks'), path.join(DATA_DIR, 'mcp', 'tasks'));
export const KNOWLEDGE_DIR = pickDir(MCP_KNOWLEDGE_DIR_ENV, path.join(DATA_DIR, 'knowledge'), path.join(DATA_DIR, 'mcp', 'knowledge'));
export const EMBEDDINGS_DIR = path.join(DATA_DIR, '.embeddings');
export const DEFAULT_PROJECT = 'mcp';
// Current project resolution (mutable)
// Priority: CLI/inline config (MCP_CONFIG_JSON or --config) -> ENV CURRENT_PROJECT -> DEFAULT_PROJECT
// Try to load last persisted state from DATA_DIR/.state.json
let STATE_FILE = path.join(DATA_DIR, '.state.json');
let persistedCurrentProject;
try {
    if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const st = JSON.parse(raw || '{}');
        if (st && typeof st.currentProject === 'string' && st.currentProject.trim().length > 0) {
            persistedCurrentProject = st.currentProject.trim();
        }
    }
}
catch (e) {
    console.warn('[config] Failed to read state file:', e);
}
let CURRENT_PROJECT_VALUE = fileConfig?.currentProject
    || process.env.CURRENT_PROJECT
    || persistedCurrentProject
    || DEFAULT_PROJECT;
export function getCurrentProject() {
    return CURRENT_PROJECT_VALUE;
}
export function setCurrentProject(name) {
    const v = (name || '').trim();
    if (v.length > 0) {
        CURRENT_PROJECT_VALUE = v;
        // also reflect into env for child components/processes that might read it lazily
        process.env.CURRENT_PROJECT = v;
        // persist to state file
        try {
            const next = { currentProject: v, updatedAt: new Date().toISOString() };
            fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
        }
        catch (e) {
            console.warn('[config] Failed to persist state file:', e);
        }
    }
    return CURRENT_PROJECT_VALUE;
}
// Helper to resolve project for API handlers and tools
export function resolveProject(project) {
    const p = (project || '').trim();
    return p.length > 0 ? p : getCurrentProject();
}
export function loadConfig() {
    const vaultRoot = fileConfig?.obsidian?.vaultRoot
        || process.env.OBSIDIAN_VAULT_ROOT
        || '/data/obsidian';
    const modeCfg = fileConfig?.embeddings?.mode || process.env.EMBEDDINGS_MODE;
    const mode = modeCfg ?? 'onnx-gpu';
    let modelPath = fileConfig?.embeddings?.modelPath || process.env.EMBEDDINGS_MODEL_PATH; // пример: /app/models/encoder.onnx
    let dimVal = fileConfig?.embeddings?.dim ?? (process.env.EMBEDDINGS_DIM ? Number(process.env.EMBEDDINGS_DIM) : undefined);
    let cacheDir = fileConfig?.embeddings?.cacheDir || process.env.EMBEDDINGS_CACHE_DIR;
    let cacheMemLimitMB = fileConfig?.embeddings?.cacheMemLimitMB ?? (process.env.EMBEDDINGS_MEM_LIMIT_MB ? Number(process.env.EMBEDDINGS_MEM_LIMIT_MB) : undefined);
    let persist = fileConfig?.embeddings?.persist ?? (process.env.EMBEDDINGS_PERSIST ? ['1', 'true', 'yes'].includes(String(process.env.EMBEDDINGS_PERSIST).toLowerCase()) : undefined);
    let batchSize = fileConfig?.embeddings?.batchSize ?? (process.env.EMBEDDINGS_BATCH_SIZE ? Number(process.env.EMBEDDINGS_BATCH_SIZE) : undefined);
    let maxLen = fileConfig?.embeddings?.maxLen ?? (process.env.EMBEDDINGS_MAX_LEN ? Number(process.env.EMBEDDINGS_MAX_LEN) : undefined);
    // Defaults for ONNX modes to avoid manual paths in container
    if ((mode === 'onnx-cpu' || mode === 'onnx-gpu')) {
        const defaultModel = '/app/models/encoder.onnx';
        try {
            if (!modelPath && fs.existsSync(defaultModel)) {
                modelPath = defaultModel;
            }
            if (dimVal == null) {
                const metaPath = '/app/models/metadata.json';
                if (fs.existsSync(metaPath)) {
                    const metaRaw = fs.readFileSync(metaPath, 'utf8');
                    const meta = JSON.parse(metaRaw);
                    const hidden = Number(meta?.hidden_size ?? meta?.hiddenSize);
                    if (!Number.isNaN(hidden))
                        dimVal = hidden;
                    if (maxLen == null) {
                        const maxp = Number(meta?.max_position_embeddings ?? meta?.maxLen);
                        if (!Number.isNaN(maxp))
                            maxLen = Math.min(512, Math.max(16, maxp));
                    }
                }
            }
            if (!cacheDir) {
                cacheDir = EMBEDDINGS_DIR;
            }
            if (batchSize == null || !(batchSize > 0))
                batchSize = 16;
            if (maxLen == null || !(maxLen > 0))
                maxLen = 256;
        }
        catch (e) {
            console.warn('[config] Failed to resolve ONNX defaults:', e);
        }
    }
    const cfg = {
        embeddings: {
            mode,
            modelPath,
            dim: dimVal,
            cacheDir: cacheDir || '',
            cacheMemLimitMB: (typeof cacheMemLimitMB === 'number' && !Number.isNaN(cacheMemLimitMB)) ? cacheMemLimitMB : 128,
            persist: persist ?? true,
            batchSize,
            maxLen,
        },
        obsidian: { vaultRoot },
    };
    // Validations and graceful degradation
    if (cfg.embeddings.mode !== 'none') {
        const missing = [];
        if (!cfg.embeddings.modelPath)
            missing.push('EMBEDDINGS_MODEL_PATH');
        if (typeof cfg.embeddings.dim !== 'number' || Number.isNaN(cfg.embeddings.dim))
            missing.push('EMBEDDINGS_DIM');
        if (!cfg.embeddings.cacheDir)
            missing.push('EMBEDDINGS_CACHE_DIR');
        if (missing.length > 0) {
            console.warn(`[config] Missing ${missing.join(', ')} for onnx mode; falling back to EMBEDDINGS_MODE=none`);
            cfg.embeddings.mode = 'none';
        }
    }
    return cfg;
}
function parseBool(v, def = false) {
    if (typeof v === 'boolean')
        return v;
    const s = String(v ?? '').toLowerCase();
    if (!s)
        return def;
    return ['1', 'true', 'yes', 'on'].includes(s);
}
// Global catalog enable switch: if false, catalog tools aren't registered
export function isCatalogEnabled() {
    const cfgFlag = fileConfig?.catalog?.enabled;
    const envFlag = process.env.CATALOG_ENABLED;
    // default: disabled to avoid surprising external calls
    return parseBool(cfgFlag ?? envFlag, false);
}
// Fine-grained read/write access flags for catalog tools
export function isCatalogReadEnabled() {
    // If catalog globally disabled, read is disabled
    if (!isCatalogEnabled())
        return false;
    const cfgFlag = fileConfig?.catalog?.readEnabled;
    const envFlag = process.env.CATALOG_READ_ENABLED;
    // default read=true when catalog enabled
    return parseBool(cfgFlag ?? envFlag, true);
}
export function isCatalogWriteEnabled() {
    // If catalog globally disabled, write is disabled
    if (!isCatalogEnabled())
        return false;
    const cfgFlag = fileConfig?.catalog?.writeEnabled;
    const envFlag = process.env.CATALOG_WRITE_ENABLED;
    // default write=false for safety unless explicitly enabled
    return parseBool(cfgFlag ?? envFlag, false);
}
function parseNum(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
export function loadCatalogConfig() {
    const fc = fileConfig?.catalog ?? {};
    const mode = fc.mode || process.env.CATALOG_MODE || 'embedded';
    const prefer = fc.prefer || process.env.CATALOG_PREFER || 'embedded';
    const embeddedEnabled = parseBool(fc?.embedded?.enabled ?? process.env.CATALOG_EMBEDDED_ENABLED, mode === 'embedded');
    const embeddedPrefix = fc?.embedded?.prefix || process.env.CATALOG_EMBEDDED_PREFIX || '/catalog';
    const embeddedStore = (fc?.embedded?.store || process.env.CATALOG_EMBEDDED_STORE || 'memory');
    const embeddedFilePath = fc?.embedded?.filePath || process.env.CATALOG_EMBEDDED_FILE_PATH;
    const embeddedSqliteDriver = fc?.embedded?.sqliteDriver
        || process.env.CATALOG_EMBEDDED_SQLITE_DRIVER;
    const remoteBase = fc?.remote?.baseUrl || process.env.CATALOG_URL || process.env.CATALOG_REMOTE_BASE_URL;
    const remoteEnabled = parseBool(fc?.remote?.enabled ?? process.env.CATALOG_REMOTE_ENABLED, mode !== 'embedded');
    const remoteTimeout = parseNum(fc?.remote?.timeoutMs ?? process.env.CATALOG_REMOTE_TIMEOUT_MS, 2000);
    const syncEnabled = parseBool(fc?.sync?.enabled ?? process.env.CATALOG_SYNC_ENABLED, false);
    const syncInterval = parseNum(fc?.sync?.intervalSec ?? process.env.CATALOG_SYNC_INTERVAL_SEC, 60);
    const syncDirection = fc?.sync?.direction
        || process.env.CATALOG_SYNC_DIRECTION
        || 'remote_to_embedded';
    const cfg = {
        mode,
        prefer,
        embedded: {
            enabled: embeddedEnabled,
            prefix: embeddedPrefix,
            store: embeddedStore,
            filePath: embeddedFilePath,
            sqliteDriver: embeddedSqliteDriver,
        },
        remote: {
            enabled: remoteEnabled,
            baseUrl: remoteBase,
            timeoutMs: remoteTimeout,
        },
        sync: {
            enabled: syncEnabled,
            intervalSec: syncInterval,
            direction: syncDirection,
        },
    };
    // Safety: if mode is remote but remote baseUrl is missing, fallback to embedded
    if (cfg.mode === 'remote' && (!cfg.remote.baseUrl || cfg.remote.baseUrl.trim().length === 0)) {
        console.warn('[catalog] CATALOG_MODE=remote but remote.baseUrl is empty — falling back to embedded');
        cfg.mode = 'embedded';
        cfg.prefer = 'embedded';
        cfg.embedded.enabled = true;
    }
    return cfg;
}
