import path from 'node:path';
import fs from 'node:fs';

export type EmbeddingsMode = 'none' | 'onnx-cpu' | 'onnx-gpu';

// Helper: read JSON config from path
function readJsonConfig(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// Enable/disable prompts build MCP tool via config or env
// Source order: fileConfig.prompts.buildEnabled -> env PROMPTS_BUILD_ENABLED -> default false
export function isPromptsBuildEnabled(): boolean {
  const cfgFlag = (fileConfig?.prompts?.buildEnabled as boolean | undefined);
  const envFlag = process.env.PROMPTS_BUILD_ENABLED;
  return parseBool(cfgFlag ?? envFlag, false);
}

// Resolve base config source: CLI --config path, MCP_CONFIG_JSON, then ENV
function getCliArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

const cliConfigPath = getCliArg('--config');
let fileConfig: any = {};
if (cliConfigPath) {
  try {
    fileConfig = readJsonConfig(cliConfigPath);
  } catch (e) {
    console.warn(`[config] Failed to read --config ${cliConfigPath}:`, e);
  }
} else if (process.env.MCP_CONFIG_JSON) {
  try {
    fileConfig = JSON.parse(process.env.MCP_CONFIG_JSON);
  } catch (e) {
    console.warn('[config] Failed to parse MCP_CONFIG_JSON:', e);
  }
}

const DATA_DIR_CFG = fileConfig.dataDir as string | undefined;
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
function pickDir(envOverride: string | undefined, primary: string, legacy: string): string {
  if (envOverride && envOverride.trim().length > 0) return envOverride;
  try {
    const hasPrimary = fs.existsSync(primary);
    const hasLegacy = fs.existsSync(legacy);
    if (hasPrimary) return primary;
    if (!hasPrimary && hasLegacy) return legacy;
  } catch {}
  return primary;
}

export const TASKS_DIR = pickDir(MCP_TASK_DIR_ENV, path.join(DATA_DIR, 'tasks'), path.join(DATA_DIR, 'mcp', 'tasks'));
export const KNOWLEDGE_DIR = pickDir(MCP_KNOWLEDGE_DIR_ENV, path.join(DATA_DIR, 'knowledge'), path.join(DATA_DIR, 'mcp', 'knowledge'));
// Prompts directory (for Prompt Library artifacts and exports)
const MCP_PROMPTS_DIR_ENV = process.env.MCP_PROMPTS_DIR;
export const PROMPTS_DIR = pickDir(MCP_PROMPTS_DIR_ENV, path.join(DATA_DIR, 'prompts'), path.join(DATA_DIR, 'mcp', 'prompts'));
export const EMBEDDINGS_DIR = path.join(DATA_DIR, '.embeddings');

export const DEFAULT_PROJECT = 'mcp';

// Current project resolution (mutable)
// Priority: CLI/inline config (MCP_CONFIG_JSON or --config) -> ENV CURRENT_PROJECT -> DEFAULT_PROJECT
// Try to load last persisted state from DATA_DIR/.state.json
let STATE_FILE = path.join(DATA_DIR, '.state.json');
let persistedCurrentProject: string | undefined;
try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const st = JSON.parse(raw || '{}');
    if (st && typeof st.currentProject === 'string' && st.currentProject.trim().length > 0) {
      persistedCurrentProject = st.currentProject.trim();
    }
  }
} catch (e) {
  console.warn('[config] Failed to read state file:', e);
}

let CURRENT_PROJECT_VALUE: string =
  (fileConfig?.currentProject as string | undefined)
  || (process.env.CURRENT_PROJECT as string | undefined)
  || persistedCurrentProject
  || DEFAULT_PROJECT;

export function getCurrentProject(): string {
  return CURRENT_PROJECT_VALUE;
}

export function setCurrentProject(name: string): string {
  const v = String(name ?? ''); // preserve as-is (including whitespace or empty)
  CURRENT_PROJECT_VALUE = v;
  // also reflect into env for child components/processes that might read it lazily
  process.env.CURRENT_PROJECT = v;
  // persist to state file
  try {
    const next = { currentProject: v, updatedAt: new Date().toISOString() };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.warn('[config] Failed to persist state file:', e);
  }
  return CURRENT_PROJECT_VALUE;
}

// Helper to resolve project for API handlers and tools
export function resolveProject(project?: string): string {
  const p = (project || '').trim();
  return p.length > 0 ? p : getCurrentProject();
}

export interface ServerConfig {
  embeddings: {
    mode: EmbeddingsMode; // 'none' | 'onnx-cpu' | 'onnx-gpu'
    modelPath?: string;   // путь к .onnx (если используется onnx)
    dim?: number;         // размерность вектора (для кэша/валидации)
    cacheDir?: string;     // куда складывать кэш векторов
    // Maximum memory to use for in-memory embeddings cache (in MB)
    cacheMemLimitMB?: number;
    // Persist embeddings to disk cache to avoid recompute across restarts
    persist?: boolean;
    batchSize?: number;   // размер батча для encode
    maxLen?: number;      // макс длина токенов
  };
  obsidian: {
    vaultRoot: string;    // корень vault'а
  };
}

export function loadConfig(): ServerConfig {
  const vaultRoot = (fileConfig?.obsidian?.vaultRoot as string | undefined)
    || process.env.OBSIDIAN_VAULT_ROOT
    || '/data/obsidian';

  const modeFromFile = (fileConfig?.embeddings && typeof fileConfig.embeddings.mode !== 'undefined');
  const modeCfg = (fileConfig?.embeddings?.mode as EmbeddingsMode | undefined) || (process.env.EMBEDDINGS_MODE as EmbeddingsMode | undefined);
  const mode: EmbeddingsMode = modeCfg ?? 'onnx-gpu';

  let modelPath = (fileConfig?.embeddings?.modelPath as string | undefined) || process.env.EMBEDDINGS_MODEL_PATH; // пример: /app/models/encoder.onnx
  let dimVal = (fileConfig?.embeddings?.dim as number | undefined) ?? (process.env.EMBEDDINGS_DIM ? Number(process.env.EMBEDDINGS_DIM) : undefined);
  let cacheDir = (fileConfig?.embeddings?.cacheDir as string | undefined) || process.env.EMBEDDINGS_CACHE_DIR;
  let cacheMemLimitMB = (fileConfig?.embeddings?.cacheMemLimitMB as number | undefined) ?? (process.env.EMBEDDINGS_MEM_LIMIT_MB ? Number(process.env.EMBEDDINGS_MEM_LIMIT_MB) : undefined);
  let persist = (fileConfig?.embeddings?.persist as boolean | undefined) ?? (process.env.EMBEDDINGS_PERSIST ? ['1','true','yes'].includes(String(process.env.EMBEDDINGS_PERSIST).toLowerCase()) : undefined);
  let batchSize = (fileConfig?.embeddings?.batchSize as number | undefined) ?? (process.env.EMBEDDINGS_BATCH_SIZE ? Number(process.env.EMBEDDINGS_BATCH_SIZE) : undefined);
  let maxLen = (fileConfig?.embeddings?.maxLen as number | undefined) ?? (process.env.EMBEDDINGS_MAX_LEN ? Number(process.env.EMBEDDINGS_MAX_LEN) : undefined);

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
          if (!Number.isNaN(hidden)) dimVal = hidden;
          if (maxLen == null) {
            const maxp = Number(meta?.max_position_embeddings ?? meta?.maxLen);
            if (!Number.isNaN(maxp)) maxLen = Math.min(512, Math.max(16, maxp));
          }
        }
      }
      if (!cacheDir) {
        cacheDir = EMBEDDINGS_DIR;
      }
      if (batchSize == null || !(batchSize > 0)) batchSize = 16;
      if (maxLen == null || !(maxLen > 0)) maxLen = 256;
    } catch (e) {
      console.warn('[config] Failed to resolve ONNX defaults:', e);
    }
  }

  const cfg: ServerConfig = {
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

  // Validations and conditional downgrade: only downgrade when mode comes from ENV
  if (cfg.embeddings.mode !== 'none') {
    const missing: string[] = [];
    if (!cfg.embeddings.modelPath) missing.push('EMBEDDINGS_MODEL_PATH');
    if (typeof cfg.embeddings.dim !== 'number' || Number.isNaN(cfg.embeddings.dim)) missing.push('EMBEDDINGS_DIM');
    if (!cfg.embeddings.cacheDir) missing.push('EMBEDDINGS_CACHE_DIR');
    if (missing.length > 0) {
      if (modeFromFile) {
        console.warn(`[config] Missing ${missing.join(', ')} for onnx mode; proceeding without downgrade (mode from file config)`);
      } else {
        console.warn(`[config] Missing ${missing.join(', ')} for onnx mode; falling back to EMBEDDINGS_MODE=none`);
        cfg.embeddings.mode = 'none';
      }
    }
  }

  return cfg;
}

// ===== Service Catalog (embedded/remote/hybrid) =====
export type CatalogMode = 'embedded' | 'remote' | 'hybrid';
export type CatalogPrefer = 'embedded' | 'remote';
export type CatalogStore = 'memory' | 'file' | 'sqlite';

export interface CatalogConfig {
  mode: CatalogMode;            // embedded | remote | hybrid
  prefer: CatalogPrefer;        // при hybrid: что предпочитать сначала
  embedded: {
    enabled: boolean;
    prefix: string;             // например "/catalog"
    store: CatalogStore;        // memory | file | sqlite
    filePath?: string;          // путь к JSON при store=file
    // Для sqlite-магазина внешний lib может поддерживать драйверы: auto | native | wasm
    sqliteDriver?: 'auto' | 'native' | 'wasm';
  };
  remote: {
    enabled: boolean;
    baseUrl?: string;           // http://service-catalog:3001
    timeoutMs: number;          // таймаут HTTP‑клиента
  };
  sync: {
    enabled: boolean;           // периодическая синхронизация между источниками
    intervalSec: number;        // интервал синка
    direction: 'remote_to_embedded' | 'embedded_to_remote' | 'none';
  };
}

function parseBool(v: any, def = false): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').toLowerCase();
  if (!s) return def;
  return ['1','true','yes','on'].includes(s);
}

// Global catalog enable switch: if false, catalog tools aren't registered
export function isCatalogEnabled(): boolean {
  const cfgFlag = (fileConfig?.catalog?.enabled as boolean | undefined);
  const envFlag = process.env.CATALOG_ENABLED;
  // default: disabled to avoid surprising external calls
  return parseBool(cfgFlag ?? envFlag, false);
}

// Fine-grained read/write access flags for catalog tools
export function isCatalogReadEnabled(): boolean {
  // If catalog globally disabled, read is disabled
  if (!isCatalogEnabled()) return false;
  const cfgFlag = (fileConfig?.catalog?.readEnabled as boolean | undefined);
  const envFlag = process.env.CATALOG_READ_ENABLED;
  // default read=true when catalog enabled
  return parseBool(cfgFlag ?? envFlag, true);
}

export function isCatalogWriteEnabled(): boolean {
  // If catalog globally disabled, write is disabled
  if (!isCatalogEnabled()) return false;
  const cfgFlag = (fileConfig?.catalog?.writeEnabled as boolean | undefined);
  const envFlag = process.env.CATALOG_WRITE_ENABLED;
  // default write=false for safety unless explicitly enabled
  return parseBool(cfgFlag ?? envFlag, false);
}

function parseNum(v: any, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadCatalogConfig(): CatalogConfig {
  const fc = fileConfig?.catalog ?? {};

  const mode = (fc.mode as CatalogMode) || (process.env.CATALOG_MODE as CatalogMode) || 'embedded';
  const prefer = (fc.prefer as CatalogPrefer) || (process.env.CATALOG_PREFER as CatalogPrefer) || 'embedded';

  const embeddedEnabled = parseBool(fc?.embedded?.enabled ?? process.env.CATALOG_EMBEDDED_ENABLED, mode === 'embedded');
  const embeddedPrefix = (fc?.embedded?.prefix as string) || process.env.CATALOG_EMBEDDED_PREFIX || '/catalog';
  const embeddedStore = ((fc?.embedded?.store as CatalogStore) || (process.env.CATALOG_EMBEDDED_STORE as CatalogStore) || 'memory');
  const embeddedFilePath = (fc?.embedded?.filePath as string) || process.env.CATALOG_EMBEDDED_FILE_PATH;
  const embeddedSqliteDriver = (fc?.embedded?.sqliteDriver as 'auto'|'native'|'wasm'|undefined)
    || (process.env.CATALOG_EMBEDDED_SQLITE_DRIVER as 'auto'|'native'|'wasm'|undefined);

  const remoteBase = (fc?.remote?.baseUrl as string) || process.env.CATALOG_URL || process.env.CATALOG_REMOTE_BASE_URL;
  const remoteEnabled = parseBool(fc?.remote?.enabled ?? process.env.CATALOG_REMOTE_ENABLED, mode !== 'embedded');
  const remoteTimeout = parseNum(fc?.remote?.timeoutMs ?? process.env.CATALOG_REMOTE_TIMEOUT_MS, 2000);

  const syncEnabled = parseBool(fc?.sync?.enabled ?? process.env.CATALOG_SYNC_ENABLED, false);
  const syncInterval = parseNum(fc?.sync?.intervalSec ?? process.env.CATALOG_SYNC_INTERVAL_SEC, 60);
  const syncDirection = (fc?.sync?.direction as CatalogConfig['sync']['direction'])
    || (process.env.CATALOG_SYNC_DIRECTION as CatalogConfig['sync']['direction'])
    || 'remote_to_embedded';

  const cfg: CatalogConfig = {
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
