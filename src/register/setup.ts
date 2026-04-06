import path from 'node:path';
import fs from 'node:fs/promises';
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, loadCatalogConfig, isToolsEnabled, isToolResourcesEnabled, isToolResourcesExecEnabled } from "../config.js";
import type { ServerConfig, CatalogConfig } from "../config.js";
import { createServiceCatalogProvider } from "../catalog/provider.js";
import type { ServiceCatalogProvider } from "../catalog/provider.js";
import { getVectorAdapter } from "../search/vector.js";
import type { VectorSearchAdapter } from "../search/index.js";
import type { ServerContext } from './context.js';
import { ToolRegistry } from '../registry/tool-registry.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('setup');

export async function createServerContext(): Promise<ServerContext> {
  const HERE_DIR = path.dirname(new URL(import.meta.url).pathname);
  const REPO_ROOT = path.resolve(HERE_DIR, '..');

  async function getPackageVersion(): Promise<string> {
    const vEnv = process.env.npm_package_version;
    if (vEnv && typeof vEnv === 'string') return vEnv;
    try {
      const raw = await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8');
      const v = JSON.parse(raw)?.version;
      return typeof v === 'string' ? v : '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  const version = await getPackageVersion();
  const SERVER_CAPS = { resources: { list: true, read: true }, tools: { call: true } } as const;

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
  const TOOL_RES_ENABLED = isToolResourcesEnabled();
  const TOOL_RES_EXEC = isToolResourcesExecEnabled();

  if (SHOW_STARTUP) {
    log.info({ mode: cfg.embeddings.mode, hasModelPath: Boolean(cfg.embeddings.modelPath), dim: cfg.embeddings.dim ?? null, cacheDir: cfg.embeddings.cacheDir || null }, 'embeddings config');
    log.info({ toolsEnabled: TOOLS_ENABLED, toolResourcesEnabled: TOOL_RES_ENABLED, toolResourcesExec: TOOL_RES_EXEC }, 'tools config');
  }

  const server = new McpServer({
    name: "mcp-task-knowledge",
    version,
    capabilities: SERVER_CAPS as unknown as ConstructorParameters<typeof McpServer>[0]['capabilities'],
  });

  let vectorAdapter: VectorSearchAdapter<unknown> | undefined;
  let vectorInitAttempted = false;

  async function ensureVectorAdapter(): Promise<VectorSearchAdapter<unknown> | undefined> {
    if (vectorAdapter) return vectorAdapter;
    if (vectorInitAttempted) return undefined;
    vectorInitAttempted = true;

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

  const toolRegistry = new ToolRegistry();
  const resourceRegistry: Array<{ id: string; uri: string; kind: 'static' | 'template'; title?: string; description?: string; mimeType?: string }> = [];
  const toolNames = new Set<string>();
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
      (baseServer.registerCapabilities as (caps: Record<string, unknown>) => void)({ resources: { list: true, read: true } });
    }
  }

  const makeResourceTemplate = (pattern: string) => new ResourceTemplate(pattern, { list: undefined } as unknown as ConstructorParameters<typeof ResourceTemplate>[1]);

  function registerToolAsResource(name: string) {
    const baseUri = `tool://${encodeURIComponent(name)}`;
    try {
      server.registerResource(
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
              handler: handler as ToolMetaHandler,
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
            handler: handler as ToolMetaHandler,
          });
          if (TOOL_RES_ENABLED) registerToolAsResource(name);
        } catch {}
        return;
      }

      try {
        const res = orig.call(server, name, def, handler);
        toolNames.add(name);
        try {
          toolRegistry.set(name, {
            title: def?.title as string | undefined,
            description: def?.description as string | undefined,
            inputSchema: def?.inputSchema as Record<string, unknown> | undefined,
            handler: handler as ToolMetaHandler,
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
              handler: handler as ToolMetaHandler,
            });
          } catch {}
          return;
        }
        throw e;
      }
    };
  })(rawServer.registerTool);

  return {
    server,
    cfg,
    catalogCfg,
    catalogProvider,
    vectorAdapter,
    vectorInitAttempted,
    ensureVectorAdapter,
    toolRegistry,
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
  };
}

/** Type alias for tool handler functions stored in ToolMeta. */
export type ToolMetaHandler = (params: Record<string, unknown>) => Promise<unknown>;
