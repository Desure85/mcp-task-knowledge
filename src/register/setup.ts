import path from 'node:path';
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool, RegisteredResource, RegisteredResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SetLevelRequestSchema, SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, loadCatalogConfig, isToolsEnabled, isToolResourcesEnabled, isToolResourcesExecEnabled } from "../config.js";
import { setLogLevel } from "../core/logger.js";
import type { ServerConfig, CatalogConfig } from "../config.js";
import { createServiceCatalogProvider } from "../catalog/provider.js";
import type { ServiceCatalogProvider } from "../catalog/provider.js";
import { getVectorAdapter } from "../search/vector.js";
import type { VectorSearchAdapter } from "../search/index.js";
import { createFileProfile } from '../storage/profiles/file/index.js';
import { createSqliteProfile } from '../storage/profiles/sqlite/index.js';
import { readStorageProfileKind } from '../storage/profile-select.js';
import { createPostgresProfile } from '../storage/profiles/postgres/index.js';
import { StoreError } from '../storage/contracts.js';
import { DATA_DIR } from '../config.js';
import { createFileEmbeddingProvider, type EmbeddingAdapterLike } from '../search/embeddings-file.js';
import {
  createExternalEmbeddingGate,
  externalEmbeddingConfigProblem,
  externalEmbeddingStartupWarning,
  readExternalEmbeddingConfig,
} from '../search/external-policy.js';
import { createExternalEmbeddingProvider } from '../search/external-provider.js';
import { createOpenAiCompatibleEmbeddingProvider } from '../search/external-http-provider.js';
import { createSecretManager } from '../core/secret-manager.js';
import type { ServerContext } from './context.js';
import { ToolRegistry } from '../registry/tool-registry.js';
import { childLogger } from '../core/logger.js';
import { ensureBootstrapAdmin, SqliteUserStore } from '../auth/user-store.js';
import { wrapToolHandler } from '../core/auth-gate.js';
import type { GateExtra } from '../core/auth-gate.js';
import { guardUnknownParams, looseInputSchema, readInputShape } from '../core/tool-arguments.js';
import { getPackageVersion } from '../utils/package-version.js';

const log = childLogger('setup');

export async function createServerContext(): Promise<ServerContext> {
  const HERE_DIR = path.dirname(new URL(import.meta.url).pathname);
  // Two levels up: src/register → repo root in dev (tsx), dist/register →
  // repo root in prod builds. One level gave dist/, silently breaking
  // package.json version lookup and the prompts.mjs reindex chain (Q-014 e2e).
  const REPO_ROOT = path.resolve(HERE_DIR, '..', '..');

  const version = await getPackageVersion();
  // MCP spec-compliant capability flags. Server handles:
  //   tools/list + tools/call, resources/list + resources/read + resources/templates/list,
  //   prompts/list + prompts/get, completion/complete.
  // SPEC-04: tools change at runtime (tools_register/tools_unregister hot
  // registration, connector init) → tools.listChanged = true and the server
  // emits notifications/tools/list_changed. Tool-as-resource wrappers
  // (TOOL_RES_ENABLED) are added/removed alongside → resources.listChanged
  // tracks that flag. Prompts are a startup snapshot (SPEC-03) and
  // resources/subscribe is unimplemented → both stay false (honesty rule:
  // declare only what the server actually emits).
  // Caveat: the SDK's registerCapabilities() force-sets listChanged=true on
  // every surface whose handlers are registered, so the advertised value is
  // true for prompts too — these flags document emission intent, not the
  // final wire value.
  // SPEC-06: resources/subscribe is implemented below; a successful mutating
  // tool call notifies subscribed resources. The SDK advertises listChanged
  // based on handler registration, so these flags document emission intent.
  const TOOL_RES_ENABLED_CAPS = isToolResourcesEnabled();
  const SERVER_CAPS = {
    resources: { subscribe: true, listChanged: TOOL_RES_ENABLED_CAPS },
    tools: { listChanged: true },
    prompts: { listChanged: false },
    completion: {},
  } as const;

  const SHOW_STARTUP = (
    process.env.LOG_STARTUP === '1' ||
    process.env.STARTUP_SILENT === '0' ||
    process.env.QUIET === '0' ||
    process.env.LOG_LEVEL === 'info' ||
    process.env.LOG_LEVEL === 'debug'
  );

  if (SHOW_STARTUP) {
    log.info({ ts: new Date().toISOString(), pid: process.pid }, 'mcp-task-knowledge starting...');
  }

  const cfg: ServerConfig = loadConfig();
  const catalogCfg: CatalogConfig = loadCatalogConfig();

  if (SHOW_STARTUP) {
    log.info({ mode: catalogCfg.mode, prefer: catalogCfg.prefer, remoteEnabled: catalogCfg.remote.enabled, hasRemoteBaseUrl: Boolean(catalogCfg.remote.baseUrl), embeddedEnabled: catalogCfg.embedded.enabled, embeddedStore: catalogCfg.embedded.store }, 'catalog config');
  }

  const catalogProvider: ServiceCatalogProvider = createServiceCatalogProvider(catalogCfg);

  const TOOLS_ENABLED = isToolsEnabled();
  const TOOL_RES_ENABLED = TOOL_RES_ENABLED_CAPS;
  const TOOL_RES_EXEC = isToolResourcesExecEnabled();

  if (SHOW_STARTUP) {
    log.info({ mode: cfg.embeddings.mode, hasModelPath: Boolean(cfg.embeddings.modelPath), dim: cfg.embeddings.dim ?? null, cacheDir: cfg.embeddings.cacheDir || null }, 'embeddings config');
    log.info({ toolsEnabled: TOOLS_ENABLED, toolResourcesEnabled: TOOL_RES_ENABLED, toolResourcesExec: TOOL_RES_EXEC }, 'tools config');
  }

  const server = new McpServer({
    name: "mcp-task-knowledge",
    version,
  });

  let vectorAdapter: VectorSearchAdapter<unknown> | undefined;
  let vectorInitAttempted = false;
  let vectorInitInFlight: Promise<VectorSearchAdapter<unknown> | undefined> | undefined;

  async function initVectorAdapter(): Promise<VectorSearchAdapter<unknown> | undefined> {
    try {
      const mode = cfg.embeddings.mode;
      if (mode === 'none') {
        log.warn('EMBEDDINGS_MODE=none — vector adapter disabled');
        return undefined;
      }
      if (!cfg.embeddings.modelPath || !cfg.embeddings.dim) {
        log.warn('Missing modelPath or dim; set EMBEDDINGS_MODEL_PATH and EMBEDDINGS_DIM');
      }
    } catch {}

    try {
      vectorAdapter = await getVectorAdapter<unknown>();
      if (vectorAdapter && typeof (vectorAdapter as unknown as Record<string, unknown>).info === 'function') {
        try {
          const info = await ((vectorAdapter as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>).info)();
          log.info({ info }, 'adapter initialized');
        } catch {}
      } else if (!vectorAdapter) {
        log.warn('adapter not initialized (getVectorAdapter returned undefined)');
      }
      return vectorAdapter;
    } catch (e) {
      log.error({ err: e }, 'vector adapter init failed');
      return undefined;
    }
  }

  /**
   * Concurrent callers share one init promise: the background warmup starts the
   * adapter while the first search may arrive, and a search that saw "attempted"
   * without the shared promise would silently lose its vector channel.
   */
  function ensureVectorAdapter(): Promise<VectorSearchAdapter<unknown> | undefined> {
    if (vectorAdapter) return Promise.resolve(vectorAdapter);
    if (vectorInitInFlight) return vectorInitInFlight;
    if (vectorInitAttempted) return Promise.resolve(undefined);
    vectorInitAttempted = true;
    vectorInitInFlight = initVectorAdapter().finally(() => {
      vectorInitInFlight = undefined;
    });
    return vectorInitInFlight;
  }

  const toolRegistry = new ToolRegistry();
  const resourceRegistry: Array<{ id: string; uri: string; kind: 'static' | 'template'; title?: string; description?: string; mimeType?: string }> = [];
  const toolNames = new Set<string>();
  const registeredToolHandles = new Map<string, RegisteredTool>();
  const registeredResourceHandles = new Map<string, RegisteredResource | RegisteredResourceTemplate>();
  const STRICT_TOOL_DEDUP = process.env.MCP_STRICT_TOOL_DEDUP === '1';

  function extractTemplateString(x: unknown): string | undefined {
    if (!x) return undefined;
    if (typeof x === 'string') return x;
    const rec = x as Record<string, unknown>;
    const tryOne = (v: unknown): string | undefined => {
      if (!v) return undefined;
      if (typeof v === 'string') return v.startsWith('[object') ? undefined : v;
      if (typeof (v as { toString?: () => string }).toString === 'function') {
        const s = (v as { toString(): string }).toString();
        if (typeof s === 'string' && !s.startsWith('[object')) return s;
      }
      const r = v as Record<string, unknown>;
      if (typeof r.template === 'string') return r.template;
      if (r.template) return tryOne(r.template);
      if (typeof r.pattern === 'string') return r.pattern;
      if (r.pattern) return tryOne(r.pattern);
      if (typeof r.hrefTemplate === 'string') return r.hrefTemplate;
      return undefined;
    };
    return tryOne(x) || tryOne(rec.template);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawServer = server as any;
  // SPEC-06: per-server subscription set. HTTP/stdio transports each construct
  // their own McpServer, so a set here is session-scoped by construction.
  const resourceSubscriptions = new Set<string>();
  const WRITE_TOOL = /(?:^|_)(create|update|close|delete|archive|trash|restore|move|claim|renew|release|transition|set|add|remove|promote|write|import|start|complete)(?:_|$)|_bulk_/;
  const RESOURCE_PREFIXES: Array<[string, string]> = [
    ['tasks_', 'tasks://'],
    ['knowledge_', 'knowledge://'],
    ['project_', 'project://'],
  ];

  async function notifyToolMutation(name: string): Promise<void> {
    if (!WRITE_TOOL.test(name) || resourceSubscriptions.size === 0) return;
    const low = rawServer?.server as { sendResourceUpdated?: (params: { uri: string }) => Promise<unknown> } | undefined;
    if (typeof low?.sendResourceUpdated !== 'function') return;
    for (const [toolPrefix, uriPrefix] of RESOURCE_PREFIXES) {
      if (!name.startsWith(toolPrefix)) continue;
      for (const uri of [...resourceSubscriptions]) {
        if (!uri.startsWith(uriPrefix)) continue;
        try {
          await low.sendResourceUpdated({ uri });
        } catch {
          // Client disconnected mid-call; the subscription will be dropped with its transport.
        }
      }
    }
  }

  const lowServer = rawServer?.server as
    | { setRequestHandler?: (schema: unknown, handler: (request: { params?: { uri?: string; level?: string } }) => Promise<unknown>) => void }
    | undefined;
  if (typeof lowServer?.setRequestHandler === 'function') {
    const capServer = lowServer as typeof lowServer & { registerCapabilities?: (caps: Record<string, unknown>) => void };
    capServer.registerCapabilities?.({ logging: {} });
    lowServer.setRequestHandler(SubscribeRequestSchema, async (request) => {
      const uri = request.params?.uri;
      if (typeof uri === 'string' && uri.length > 0) resourceSubscriptions.add(uri);
      return {};
    });
    lowServer.setRequestHandler(SetLevelRequestSchema, async (request) => {
      if (request.params?.level) setLogLevel(request.params.level);
      return {};
    });
    lowServer.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
      const uri = request.params?.uri;
      if (typeof uri === 'string') resourceSubscriptions.delete(uri);
      return {};
    });
  }

  // SEC-003: lazy gate resolution. The holder is populated with the live
  // ServerContext before this function returns; AuthManager itself is
  // attached later by AppContainer.init — handlers read it per call.
  const gateCtx: { ctx?: ServerContext } = {};
  const gateResolve = () => ({
    auth: gateCtx.ctx?.authManager,
    transport: gateCtx.ctx?.transportType ?? 'stdio',
    security: gateCtx.ctx?.securityStack,
  });
  const gateHandler = (name: string, handler: unknown): unknown => {
    if (typeof handler !== 'function') return handler;
    return wrapToolHandler(
      name,
      handler as (args: unknown, extra?: GateExtra) => unknown,
      gateResolve,
    );
  };
  // AUD-10: registry must store the GATED handler so tools_run/tools_batch/
  // REST wrappers get auth-gate + SecurityStack + requestScope. Exposed on
  // ctx for registration paths outside this function (connector ops in
  // app-container.ts) — they must gate before toolRegistry.set too.
  const gateToolHandler = (name: string, handler: ToolMetaHandler): ToolMetaHandler =>
    gateHandler(name, handler) as ToolMetaHandler;
  rawServer.registerResource = ((orig: (...args: unknown[]) => unknown) => {
    return function(id: string, uriOrTemplate: unknown, info: { title?: string; description?: string; mimeType?: string }, handler: unknown) {
      try {
        const isTemplate = typeof uriOrTemplate !== 'string';
        const uriStr = isTemplate ? (extractTemplateString(uriOrTemplate) || '<template>') : String(uriOrTemplate);
        resourceRegistry.push({ id, uri: uriStr, kind: isTemplate ? 'template' : 'static', title: info?.title, description: info?.description, mimeType: info?.mimeType });
      } catch {}
      return orig.call(server, id, uriOrTemplate, info, handler);
    };
  })(rawServer.registerResource);

  function normalizeBase64(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    return normalized + '='.repeat(padding);
  }

  const initResourceHandlers = rawServer?.setResourceRequestHandlers;
  if (typeof initResourceHandlers === 'function') {
    initResourceHandlers.call(server);
  }

  const baseServer = rawServer?.server as Record<string, unknown> | undefined;
  if (baseServer) {
    const listHandler = async () => {
      const resources = resourceRegistry
        .filter((r) => r.kind === 'static')
        .map((r) => ({
          uri: r.uri,
          name: r.title ?? null,
          description: r.description ?? null,
          mimeType: r.mimeType ?? null,
        }));

      const resourceTemplates = resourceRegistry
        .filter((r) => r.kind === 'template')
        .map((r) => ({
          name: r.id,
          uriTemplate: r.uri,
          title: r.title ?? null,
          description: r.description ?? null,
          mimeType: r.mimeType ?? null,
        }));

      return { resources, resourceTemplates };
    };

    if (baseServer._requestHandlers instanceof Map) {
      (baseServer._requestHandlers as Map<string, (...args: unknown[]) => unknown>).set('resources/list', async () => listHandler());
    }

    if (typeof baseServer.registerCapabilities === 'function') {
      (baseServer.registerCapabilities as (caps: Record<string, unknown>) => void)({ resources: { list: true, read: true, subscribe: true }, logging: {} });
    }
  }

  const makeResourceTemplate = (pattern: string) => new ResourceTemplate(pattern, { list: undefined } as unknown as ConstructorParameters<typeof ResourceTemplate>[1]);

  function registerToolAsResource(name: string) {
    const baseUri = `tool://${encodeURIComponent(name)}`;
    try {
      const handle = server.registerResource(
        `tool_${name}`,
        baseUri,
        {
          title: `Tool: ${name}`,
          description: `Resource wrapper for tool ${name}. Read base URI to get schema. Execution must be done via tools.run RPC (not a resource).`,
          mimeType: "application/json",
        },
        async (uri) => {
          const href = uri.href;
          const schemaMatch = href.match(/^tool:\/\/([^\/?#]+)(?:\/schema)?$/);
          if (schemaMatch && decodeURIComponent(schemaMatch[1]) === name) {
            const meta = toolRegistry.get(name);
            if (!meta) {
              return { contents: [{ uri: href, text: JSON.stringify({ error: `Tool not found: ${name}` }, null, 2), mimeType: 'application/json' }] };
            }
            const payload = {
              name,
              title: meta.title ?? null,
              description: meta.description ?? null,
              inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
            };
            return { contents: [{ uri: href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] };
          }
          return { contents: [{ uri: href, text: JSON.stringify({ error: 'invalid tool resource path', examples: [`${baseUri}`, `${baseUri}/schema`] }, null, 2), mimeType: 'application/json' }] };
        }
      );
      registeredResourceHandles.set(`tool_${name}`, handle);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (typeof msg === 'string' && msg.includes('already registered')) {
        log.warn('already registered for tool resource: %s — skipping', name);
      } else {
        throw e;
      }
    }
  }

  rawServer.registerTool = ((orig: (...args: unknown[]) => unknown) => {
    rawServer._registerToolOrig = orig;
    return function (name: string, def: Record<string, unknown> | undefined, handler: unknown) {
      // AC-01: unknown top-level arguments must fail loudly instead of being stripped by the
      // SDK's Zod validation. The SDK receives a loose object schema so extra keys survive,
      // the guard below reports them, and the registry keeps the raw shape it always had.
      const shape = readInputShape(def?.inputSchema);
      const guarded = shape
        ? guardUnknownParams(name, Object.keys(shape), handler as (args: unknown, extra?: unknown) => unknown)
        : handler;
      const gated = gateHandler(name, guarded);
      const notifiedGated = async (args: unknown, extra?: unknown) => {
        const result = await (gated as (a: unknown, e?: unknown) => Promise<unknown>)(args, extra);
        await notifyToolMutation(name);
        return result;
      };
      const sdkDef = shape ? { ...def, inputSchema: looseInputSchema(shape) } : def;
      if (toolRegistry.has(name)) {
        const msg = `[tools] duplicate tool registration detected: "${name}"`;
        if (STRICT_TOOL_DEDUP) {
          throw new Error(msg + ' (MCP_STRICT_TOOL_DEDUP=1)');
        } else {
          log.warn('duplicate tool registration detected: "%s" — skipping re-registration', name);
          try {
            toolRegistry.set(name, {
              title: def?.title as string | undefined,
              description: def?.description as string | undefined,
              inputSchema: def?.inputSchema as Record<string, unknown> | undefined,
              handler: notifiedGated as ToolMetaHandler,
            });
            if (TOOL_RES_ENABLED) registerToolAsResource(name);
          } catch {}
          return;
        }
      }

      if (!TOOLS_ENABLED && !['tools_list','tool_schema','tool_help','tools_run'].includes(name)) {
        toolNames.add(name);
        try {
          toolRegistry.set(name, {
            title: def?.title as string | undefined,
            description: def?.description as string | undefined,
            inputSchema: def?.inputSchema as Record<string, unknown> | undefined,
            handler: notifiedGated as ToolMetaHandler,
          });
          if (TOOL_RES_ENABLED) registerToolAsResource(name);
        } catch {}
        return;
      }

      try {
        const res = orig.call(server, name, sdkDef, notifiedGated);
        toolNames.add(name);
        if (res) registeredToolHandles.set(name, res as RegisteredTool);
        try {
          toolRegistry.set(name, {
            title: def?.title as string | undefined,
            description: def?.description as string | undefined,
            inputSchema: def?.inputSchema as Record<string, unknown> | undefined,
            handler: notifiedGated as ToolMetaHandler,
          });
          if (TOOL_RES_ENABLED) registerToolAsResource(name);
        } catch {}
        return res;
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : undefined;
        if (errMsg && typeof errMsg === 'string' && errMsg.includes('already registered')) {
          log.warn('SDK reported already registered for "%s" — skipping', name);
          toolNames.add(name);
          try {
            toolRegistry.set(name, {
              title: def?.title as string | undefined,
              description: def?.description as string | undefined,
              inputSchema: def?.inputSchema as Record<string, unknown> | undefined,
              handler: notifiedGated as ToolMetaHandler,
            });
          } catch {}
          return;
        }
        throw e;
      }
    };
  })(rawServer.registerTool);

  // SEC-003: server.tool() bypasses registerTool (both call
  // _createRegisteredTool directly), so gate it too (connector path).
  if (typeof rawServer.tool === 'function') {
    rawServer.tool = ((orig: (...args: unknown[]) => unknown) => {
      return function (name: string, ...rest: unknown[]) {
        const last = rest[rest.length - 1];
        if (typeof last === 'function') {
          rest[rest.length - 1] = gateHandler(name, last);
        }
        const res = orig.call(server, name, ...rest);
        if (res) registeredToolHandles.set(name, res as RegisteredTool);
        return res;
      };
    })(rawServer.tool.bind(server));
  }

  // Y-04a: external embeddings are opt-in. The gate is built here (the composition root) and given
  // to the profile's indexing service, so texts of private projects and trustLevel=external docs are
  // never queued for a remote provider. The startup warning is logged once, at boot.
  const externalEmbeddingConfig = readExternalEmbeddingConfig();
  const externalEmbeddingWarning = externalEmbeddingStartupWarning(externalEmbeddingConfig);
  if (externalEmbeddingWarning) log.warn({ external: true }, externalEmbeddingWarning);
  const externalEmbeddingGate = createExternalEmbeddingGate(externalEmbeddingConfig);

  // Y-05a: STORAGE_PROFILE picks implementation behind the same contracts. The file profile stays
  // the default (behaviour unchanged); the sqlite profile owns its database file under DATA_DIR so a
  // caller-provided root still matches ADR-009 rule 1.
  const storageKind = readStorageProfileKind();
  const embeddingProviderFactory = async () => {
    if (externalEmbeddingConfig.enabled) {
      const problem = externalEmbeddingConfigProblem(externalEmbeddingConfig);
      if (problem) {
        log.warn({ external: true }, `external embeddings misconfigured: ${problem}`);
        return undefined;
      }
      // Y-04b: OpenAI-compatible HTTP provider, created only after the secret is resolved.
      return createExternalEmbeddingProvider({
        config: externalEmbeddingConfig,
        policy: externalEmbeddingGate,
        secrets: createSecretManager(),
        createInner: (secret) =>
          createOpenAiCompatibleEmbeddingProvider({
            baseUrl: externalEmbeddingConfig.baseUrl!,
            model: externalEmbeddingConfig.model!,
            apiKey: secret ?? '',
          }),
        onEvent: (event) => {
          if (event.type === 'error') log.error({ external: true }, event.message);
          else log.warn({ external: true }, event.message);
        },
      });
    }

    // Local ONNX provider: resolved lazily through ensureVectorAdapter.
    const adapter = await ensureVectorAdapter();
    if (!adapter) return undefined;
    const candidate = adapter as unknown as Partial<EmbeddingAdapterLike>;
    if (
      typeof candidate.isReady !== 'function' ||
      typeof candidate.fingerprint !== 'function' ||
      typeof candidate.embed !== 'function'
    ) {
      return undefined;
    }
    return createFileEmbeddingProvider(candidate as EmbeddingAdapterLike);
  };
  const externalPolicy = (item: { project: string; trustLevel?: 'system' | 'user' | 'external' }) =>
    externalEmbeddingGate.decide({ project: item.project, trustLevel: item.trustLevel });
  const fileStorageOptions = {
    externalPolicy,
    embeddingProvider: embeddingProviderFactory,
  };
  const storage =
    storageKind === 'postgres'
      ? await createPostgresProfile({
          connectionString: process.env.POSTGRES_URL ?? '',
          embeddingProvider: embeddingProviderFactory,
          externalPolicy,
          ...(process.env.STORAGE_BLOBS_DIR ? { blobsDir: process.env.STORAGE_BLOBS_DIR } : {}),
        }).catch((error) => {
          throw error instanceof StoreError
            ? error
            : new StoreError('CONFIG_MISMATCH', `postgres profile failed to open: ${(error as Error).message}`, {
                hint: 'set POSTGRES_URL to a reachable PostgreSQL connection string',
              });
        })
      : storageKind === 'sqlite'
        ? createSqliteProfile({
            databasePath: path.join(DATA_DIR, '.index', 'storage.sqlite'),
            embeddingProvider: embeddingProviderFactory,
            externalPolicy,
          })
        : createFileProfile(fileStorageOptions);
  log.info({ storageProfile: storage.manifest.profile }, 'storage profile selected');

  // T-01a: auth.db is opened only when login/auth is configured; env admin is a bootstrap row.
  let userStore: SqliteUserStore | undefined;
  if (process.env.JWT_SECRET || process.env.MCP_LOGIN_USER || process.env.MCP_LOGIN_PASSWORD) {
    userStore = new SqliteUserStore(path.join(DATA_DIR, 'auth.db'));
    ensureBootstrapAdmin(userStore);
  }

  const ctx: ServerContext = {
    server,
    // Y-02e: one profile per server context (file profile today; STORAGE_PROFILE
    // selects another profile in Y-05/Y-06). Registrators read collections from here
    // instead of importing storage modules (Y-02e2/e3).
    storage,
    ...(userStore ? { userStore } : {}),
    cfg,
    catalogCfg,
    catalogProvider,
    // Getters keep the context in sync with the lazy init above: the adapter is
    // assigned only on the first ensureVectorAdapter() call, so a plain property
    // would stay undefined forever.
    get vectorAdapter() { return vectorAdapter; },
    get vectorInitAttempted() { return vectorInitAttempted; },
    ensureVectorAdapter,
    toolRegistry,
    registeredToolHandles,
    registeredResourceHandles,
    resourceRegistry,
    toolNames,
    STRICT_TOOL_DEDUP,
    TOOLS_ENABLED,
    TOOL_RES_ENABLED,
    TOOL_RES_EXEC,
    REPO_ROOT,
    SERVER_CAPS,
    normalizeBase64,
    makeResourceTemplate,
    registerToolAsResource,
    gateToolHandler,
  };
  gateCtx.ctx = ctx;
  return ctx;
}

/** Type alias for tool handler functions stored in ToolMeta. */
export type ToolMetaHandler = (
  params: Record<string, unknown>,
  extra?: unknown,
) => Promise<unknown>;
