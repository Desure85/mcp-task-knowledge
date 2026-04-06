import path from 'node:path';
import fs from 'node:fs/promises';
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, loadCatalogConfig, isToolsEnabled, isToolResourcesEnabled, isToolResourcesExecEnabled } from "../config.js";
import { createServiceCatalogProvider } from "../catalog/provider.js";
import { getVectorAdapter } from "../search/vector.js";
import type { ServerContext } from './context.js';
import { ToolRegistry } from '../registry/tool-registry.js';

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
    console.error('[startup] mcp-task-knowledge starting...', { ts: new Date().toISOString(), pid: process.pid });
  }

  const cfg = loadConfig();
  const catalogCfg = loadCatalogConfig();

  if (SHOW_STARTUP) {
    console.error('[startup][catalog]', { mode: catalogCfg.mode, prefer: catalogCfg.prefer, remoteEnabled: catalogCfg.remote.enabled, hasRemoteBaseUrl: Boolean(catalogCfg.remote.baseUrl), embeddedEnabled: catalogCfg.embedded.enabled, embeddedStore: catalogCfg.embedded.store });
  }

  const catalogProvider = createServiceCatalogProvider(catalogCfg);

  const TOOLS_ENABLED = isToolsEnabled();
  const TOOL_RES_ENABLED = isToolResourcesEnabled();
  const TOOL_RES_EXEC = isToolResourcesExecEnabled();

  if (SHOW_STARTUP) {
    console.error('[startup][embeddings]', { mode: cfg.embeddings.mode, hasModelPath: Boolean(cfg.embeddings.modelPath), dim: cfg.embeddings.dim ?? null, cacheDir: cfg.embeddings.cacheDir || null });
    console.error('[startup][tools]', { toolsEnabled: TOOLS_ENABLED, toolResourcesEnabled: TOOL_RES_ENABLED, toolResourcesExec: TOOL_RES_EXEC });
  }

  const server = new McpServer({
    name: "mcp-task-knowledge",
    version,
    capabilities: SERVER_CAPS as any,
  });

  let vectorAdapter: any | undefined;
  let vectorInitAttempted = false;

  async function ensureVectorAdapter(): Promise<any | undefined> {
    if (vectorAdapter) return vectorAdapter;
    if (vectorInitAttempted) return undefined;
    vectorInitAttempted = true;

    try {
      const mode = cfg.embeddings.mode;
      if (mode === 'none') {
        console.warn('[embeddings] EMBEDDINGS_MODE=none — vector adapter disabled');
        return undefined;
      }
      if (!cfg.embeddings.modelPath || !cfg.embeddings.dim) {
        console.warn('[embeddings] Missing modelPath or dim; set EMBEDDINGS_MODEL_PATH and EMBEDDINGS_DIM');
      }
    } catch {}

    try {
      vectorAdapter = await getVectorAdapter<any>();
      if (vectorAdapter && typeof (vectorAdapter as any).info === 'function') {
        try {
          const info = await (vectorAdapter as any).info();
          console.error('[embeddings] adapter initialized', info);
        } catch {}
      } else if (!vectorAdapter) {
        console.warn('[embeddings] adapter not initialized (getVectorAdapter returned undefined)');
      }
      return vectorAdapter;
    } catch (e) {
      console.error('[embeddings] vector adapter init failed:', e);
      return undefined;
    }
  }

  const toolRegistry = new ToolRegistry();
  const resourceRegistry: Array<{ id: string; uri: string; kind: 'static' | 'template'; title?: string; description?: string; mimeType?: string }> = [];
  const toolNames = new Set<string>();
  const STRICT_TOOL_DEDUP = process.env.MCP_STRICT_TOOL_DEDUP === '1';

  function extractTemplateString(x: any): string | undefined {
    if (!x) return undefined;
    if (typeof x === 'string') return x;
    const tryOne = (v: any): string | undefined => {
      if (!v) return undefined;
      if (typeof v === 'string') return v.startsWith('[object') ? undefined : v;
      if (typeof v.toString === 'function') {
        const s = v.toString();
        if (typeof s === 'string' && !s.startsWith('[object')) return s;
      }
      if (typeof (v as any).template === 'string') return (v as any).template;
      if ((v as any).template) return tryOne((v as any).template);
      if (typeof (v as any).pattern === 'string') return (v as any).pattern;
      if ((v as any).pattern) return tryOne((v as any).pattern);
      if (typeof (v as any).hrefTemplate === 'string') return (v as any).hrefTemplate;
      return undefined;
    };
    return tryOne(x) || tryOne((x as any).template);
  }

  (server as any).registerResource = ((orig: any) => {
    return function(id: string, uriOrTemplate: any, info: { title?: string; description?: string; mimeType?: string }, handler: any) {
      try {
        const isTemplate = typeof uriOrTemplate !== 'string';
        const uriStr = isTemplate ? (extractTemplateString(uriOrTemplate) || '<template>') : String(uriOrTemplate);
        resourceRegistry.push({ id, uri: uriStr, kind: isTemplate ? 'template' : 'static', title: info?.title, description: info?.description, mimeType: info?.mimeType });
      } catch {}
      return orig.call(server, id, uriOrTemplate, info, handler);
    };
  })((server as any).registerResource);

  function normalizeBase64(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    return normalized + '='.repeat(padding);
  }

  const initResourceHandlers = (server as any)?.setResourceRequestHandlers;
  if (typeof initResourceHandlers === 'function') {
    initResourceHandlers.call(server);
  }

  const baseServer = (server as any)?.server;
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
      baseServer._requestHandlers.set('resources/list', async (_req: any, _extra: any) => listHandler());
    }

    if (typeof baseServer.registerCapabilities === 'function') {
      baseServer.registerCapabilities({ resources: { list: true, read: true } });
    }
  }

  const makeResourceTemplate = (pattern: string) => new ResourceTemplate(pattern, {} as any);

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
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (typeof msg === 'string' && msg.includes('already registered')) {
        console.warn(`[resources] already registered for tool resource: ${name} — skipping`);
      } else {
        throw e;
      }
    }
  }

  (server as any).registerTool = ((orig: any) => {
    (server as any)._registerToolOrig = orig;
    return function (name: string, def: any, handler: any) {
      if (toolRegistry.has(name)) {
        const msg = `[tools] duplicate tool registration detected: "${name}"`;
        if (STRICT_TOOL_DEDUP) {
          throw new Error(msg + ' (MCP_STRICT_TOOL_DEDUP=1)');
        } else {
          console.warn(msg + ' — skipping re-registration');
          try {
            toolRegistry.set(name, {
              title: def?.title,
              description: def?.description,
              inputSchema: def?.inputSchema,
              handler,
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
            title: def?.title,
            description: def?.description,
            inputSchema: def?.inputSchema,
            handler,
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
            title: def?.title,
            description: def?.description,
            inputSchema: def?.inputSchema,
            handler,
          });
          if (TOOL_RES_ENABLED) registerToolAsResource(name);
        } catch {}
        return res;
      } catch (e: any) {
        if (e && typeof e.message === 'string' && e.message.includes('already registered')) {
          console.warn(`[tools] SDK reported already registered for "${name}" — skipping`);
          toolNames.add(name);
          try {
            toolRegistry.set(name, {
              title: def?.title,
              description: def?.description,
              inputSchema: def?.inputSchema,
              handler,
            });
          } catch {}
          return;
        }
        throw e;
      }
    };
  })((server as any).registerTool);

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