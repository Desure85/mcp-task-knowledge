/**
 * proxy/passthrough.ts — verbatim MCP surface forwarding (MU-09).
 *
 * The bridge must publish the core's `tools/list`, `prompts/list` and
 * `resources/*` results **without rewriting JSON Schema into Zod**. The
 * previous mirror (`ProxyMirror`) rebuilt every `inputSchema` through
 * `jsonSchemaToZod`, which dropped nested `required`, `enum`, bounds,
 * `description`, `default`, `format` and `pattern`, and silently turned
 * nullable/type-array fields into `z.any()`.
 *
 * Approach A: the downstream server is a low-level `Server`, and each method
 * handler forwards the request parameters to the upstream client and returns
 * the upstream result unchanged. Validation stays on the core (single source
 * of truth); the bridge only proxies.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('proxy:passthrough');

export interface PassthroughStats {
  tools: number;
  resources: number;
  resourceTemplates: number;
  prompts: number;
}

/**
 * Capabilities the bridge advertises. Tools/resources/prompts are always
 * declared (the handlers are pure forwards), `listChanged` mirrors the core so
 * a client is told to re-fetch exactly when the core announces a change.
 */
export function passthroughCapabilities(upstream?: ServerCapabilities): ServerCapabilities {
  return {
    tools: { listChanged: Boolean(upstream?.tools?.listChanged) },
    resources: { listChanged: Boolean(upstream?.resources?.listChanged) },
    prompts: { listChanged: Boolean(upstream?.prompts?.listChanged) },
  };
}

export interface ProxyPassthroughOptions {
  /** CM-04: `meta` exposes only the discovery/run surface. */
  toolsMode?: 'full' | 'meta';
}

const META_TOOLS = new Set(['tools_list', 'tool_schema', 'tool_help', 'tools_run']);

export class ProxyPassthrough {
  private client: Client;
  private recovery?: (err: unknown) => Promise<boolean>;
  private readonly toolsMode: 'full' | 'meta';

  constructor(
    client: Client,
    private readonly server: Server,
    options: ProxyPassthroughOptions = {},
  ) {
    this.client = client;
    this.toolsMode = options.toolsMode ?? 'full';
    this.watchNotifications();
  }

  /** Swap the upstream client after a reconnect (MU-08). */
  setClient(client: Client): void {
    this.client = client;
    this.watchNotifications();
  }

  /**
   * Install a recovery hook. When an upstream call throws, the hook may
   * re-establish the session; a `true` result retries the call once.
   */
  setRecovery(recovery: (err: unknown) => Promise<boolean>): void {
    this.recovery = recovery;
  }

  /**
   * Register the seven forwarded methods. Handlers are installed once: they
   * read `this.client` at call time, so a reconnect needs no re-registration.
   */
  attach(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, (request) =>
      this.call(async (client) => {
        const result = await client.listTools(request.params);
        if (this.toolsMode === 'full') return result;
        return { ...result, tools: (result.tools ?? []).filter((tool) => META_TOOLS.has(tool.name)) };
      }));
    this.server.setRequestHandler(CallToolRequestSchema, (request) => {
      if (this.toolsMode === 'meta' && !META_TOOLS.has(request.params.name)) {
        throw new Error(`tool not exposed in meta mode: ${request.params.name}`);
      }
      return this.call((client) => client.callTool(request.params));
    });
    this.server.setRequestHandler(ListResourcesRequestSchema, (request) =>
      this.call((client) => client.listResources(request.params)));
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) =>
      this.call((client) => client.listResourceTemplates(request.params)));
    this.server.setRequestHandler(ReadResourceRequestSchema, (request) =>
      this.call((client) => client.readResource(request.params)));
    this.server.setRequestHandler(ListPromptsRequestSchema, (request) =>
      this.call((client) => client.listPrompts(request.params)));
    this.server.setRequestHandler(GetPromptRequestSchema, (request) =>
      this.call((client) => client.getPrompt(request.params)));
  }

  /**
   * Count the upstream surface before the downstream transport is connected.
   * Throws when the upstream cannot be listed, so `start()` fails with a real
   * connection/authentication error instead of serving an empty tool list.
   */
  async probe(): Promise<PassthroughStats> {
    const allTools = (await this.client.listTools()).tools ?? [];
    const tools = this.toolsMode === 'meta' ? allTools.filter((tool) => META_TOOLS.has(tool.name)) : allTools;
    const resources = await this.client.listResources().then((r) => r.resources ?? []).catch(() => []);
    const resourceTemplates = await this.client.listResourceTemplates().then((r) => r.resourceTemplates ?? []).catch(() => []);
    const prompts = await this.client.listPrompts().then((r) => r.prompts ?? []).catch(() => []);
    return {
      tools: tools.length,
      resources: resources.length,
      resourceTemplates: resourceTemplates.length,
      prompts: prompts.length,
    };
  }

  /**
   * Mirror list-changed notifications upstream → downstream. The core emits
   * them for hot tool registration (SPEC-04); without this the advertised
   * `listChanged` capability would be a lie.
   */
  private watchNotifications(): void {
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, () =>
      this.notify(() => this.server.sendToolListChanged()));
    this.client.setNotificationHandler(ResourceListChangedNotificationSchema, () =>
      this.notify(() => this.server.sendResourceListChanged()));
    this.client.setNotificationHandler(PromptListChangedNotificationSchema, () =>
      this.notify(() => this.server.sendPromptListChanged()));
  }

  private async notify(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      // No downstream transport yet (probe phase) or already closing.
      log.debug({ err }, 'downstream list-changed notification skipped');
    }
  }

  private async call<T>(call: (client: Client) => Promise<T>): Promise<T> {
    try {
      return await call(this.client);
    } catch (err) {
      if (!this.recovery) throw err;
      const recovered = await this.recovery(err).catch(() => false);
      if (!recovered) throw err;
      return call(this.client);
    }
  }
}
