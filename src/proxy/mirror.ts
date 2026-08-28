/**
 * proxy/mirror.ts — Tool/resource/prompt mirroring (P-002).
 *
 * Fetches tools, resources, and prompts from the upstream MCP server
 * and registers them on the downstream McpServer. When a downstream
 * client calls a mirrored tool/resource/prompt, the call is forwarded
 * to the upstream server.
 *
 * JSON Schema → ZodRawShape conversion:
 *   Upstream returns JSON Schema for tool input parameters.
 *   McpServer.tool() expects ZodRawShape. We convert common JSON Schema
 *   types (string, number, boolean, array, object) to Zod equivalents.
 *   Unknown types fall back to z.any() so the call still works.
 */

import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpServer, RegisteredTool, RegisteredResource, RegisteredPrompt } from '@modelcontextprotocol/sdk/server/mcp.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('proxy:mirror');

// ─── JSON Schema → ZodRawShape ────────────────────────────────────

type ZodRawShape = Record<string, z.ZodTypeAny>;

/**
 * Convert a JSON Schema property definition to a Zod type.
 * Handles: string, number, integer, boolean, array, object.
 * Falls back to z.any() for unknown types.
 */
function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (typeof schema !== 'object' || schema === null) {
    return z.any();
  }

  const s = schema as Record<string, unknown>;
  const type = s.type as string | undefined;

  // Note: optional/required is handled at the shape level (jsonSchemaToShape),
  // not here. This function returns the base type only.

  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (s.items) {
        return z.array(jsonSchemaToZod(s.items));
      }
      return z.array(z.any());
    case 'object':
      if (s.properties && typeof s.properties === 'object') {
        const shape: ZodRawShape = {};
        for (const [key, val] of Object.entries(s.properties)) {
          shape[key] = jsonSchemaToZod(val);
        }
        return z.object(shape);
      }
      return z.record(z.any());
    default:
      return z.any();
  }
}

/**
 * Convert a JSON Schema object (with properties + required) to ZodRawShape.
 * This is used to convert tool inputSchema to the format expected by
 * McpServer.tool().
 */
function jsonSchemaToShape(inputSchema: unknown): ZodRawShape {
  if (typeof inputSchema !== 'object' || inputSchema === null) {
    return {};
  }

  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== 'object') {
    return {};
  }

  const requiredArr = Array.isArray(schema.required) ? schema.required as string[] : [];
  const shape: ZodRawShape = {};

  for (const [key, val] of Object.entries(properties)) {
    const zodType = jsonSchemaToZod(val);
    if (requiredArr.includes(key)) {
      shape[key] = zodType;
    } else {
      shape[key] = zodType.optional();
    }
  }

  return shape;
}

// ─── ProxyMirror ──────────────────────────────────────────────────

export interface MirrorStats {
  tools: number;
  resources: number;
  prompts: number;
  errors: number;
}

export class ProxyMirror {
  private registeredTools = new Map<string, RegisteredTool>();
  private registeredResources = new Map<string, RegisteredResource>();
  private registeredPrompts = new Map<string, RegisteredPrompt>();
  private _stats: MirrorStats = { tools: 0, resources: 0, prompts: 0, errors: 0 };

  constructor(
    private readonly client: Client,
    private readonly server: McpServer,
  ) {}

  get stats(): MirrorStats {
    return { ...this._stats };
  }

  /**
   * Mirror tools from upstream to downstream server.
   * For each upstream tool, registers a proxy tool that forwards calls.
   * Returns the number of tools mirrored.
   */
  async mirrorTools(): Promise<number> {
    let mirrored = 0;

    try {
      const result = await this.client.listTools();
      const tools = result.tools ?? [];

      for (const tool of tools) {
        try {
          const shape = jsonSchemaToShape(tool.inputSchema);
          const description = tool.description ?? tool.name;

          // Register proxy tool — forwards call to upstream
          // Callback cast: SDK client/server types are compatible at runtime
          // but TypeScript can't verify the passthrough content shape match.
          const cb = async (args: Record<string, unknown>) => {
            log.debug({ tool: tool.name }, 'forwarding tool call');
            const result = await this.client.callTool({
              name: tool.name,
              arguments: args,
            });
            return result;
          };
          const registered = this.server.tool(
            tool.name,
            description,
            shape,
            cb as never,
          );

          this.registeredTools.set(tool.name, registered);
          mirrored++;
        } catch (err) {
          log.warn({ tool: tool.name, err }, 'failed to mirror tool');
          this._stats.errors++;
        }
      }

      this._stats.tools = mirrored;
      log.info({ count: mirrored }, 'mirrored tools from upstream');
    } catch (err) {
      log.error({ err }, 'failed to list tools from upstream');
      this._stats.errors++;
    }

    return mirrored;
  }

  /**
   * Mirror resources from upstream to downstream server.
   * Registers a resource template that forwards read requests.
   * Returns the number of resources mirrored.
   */
  async mirrorResources(): Promise<number> {
    let mirrored = 0;

    try {
      const result = await this.client.listResources();
      const resources = result.resources ?? [];

      for (const resource of resources) {
        try {
          const uri = resource.uri;
          const name = resource.name ?? uri;
          const description = resource.description ?? name;

          // Register proxy resource — forwards read to upstream
          const registered = this.server.resource(
            name,
            uri,
            async (uri) => {
              log.debug({ uri: uri.href }, 'forwarding resource read');
              const result = await this.client.readResource({ uri: uri.href });
              return result;
            },
          );

          this.registeredResources.set(uri, registered);
          mirrored++;
        } catch (err) {
          log.warn({ resource: resource.uri, err }, 'failed to mirror resource');
          this._stats.errors++;
        }
      }

      this._stats.resources = mirrored;
      log.info({ count: mirrored }, 'mirrored resources from upstream');
    } catch (err) {
      log.error({ err }, 'failed to list resources from upstream');
      this._stats.errors++;
    }

    return mirrored;
  }

  /**
   * Mirror prompts from upstream to downstream server.
   * Returns the number of prompts mirrored.
   */
  async mirrorPrompts(): Promise<number> {
    let mirrored = 0;

    try {
      const result = await this.client.listPrompts();
      const prompts = result.prompts ?? [];

      for (const prompt of prompts) {
        try {
          const name = prompt.name;
          const description = prompt.description ?? name;

          // Convert prompt arguments to ZodRawShape
          const argsShape: ZodRawShape = {};
          if (prompt.arguments && Array.isArray(prompt.arguments)) {
            for (const arg of prompt.arguments) {
              argsShape[arg.name] = z.string().optional();
            }
          }

          const registered = this.server.prompt(
            name,
            description,
            argsShape,
            async (args) => {
              log.debug({ prompt: name }, 'forwarding prompt get');
              const result = await this.client.getPrompt({
                name,
                arguments: args as Record<string, string> | undefined,
              });
              return result;
            },
          );

          this.registeredPrompts.set(name, registered);
          mirrored++;
        } catch (err) {
          log.warn({ prompt: prompt.name, err }, 'failed to mirror prompt');
          this._stats.errors++;
        }
      }

      this._stats.prompts = mirrored;
      log.info({ count: mirrored }, 'mirrored prompts from upstream');
    } catch (err) {
      log.error({ err }, 'failed to list prompts from upstream');
      this._stats.errors++;
    }

    return mirrored;
  }

  /**
   * Mirror all (tools + resources + prompts) from upstream.
   * Returns combined stats.
   */
  async mirrorAll(): Promise<MirrorStats> {
    await this.mirrorTools();
    await this.mirrorResources();
    await this.mirrorPrompts();
    return this.stats;
  }

  /**
   * Unregister all mirrored items from the downstream server.
   * Called on reconnect or shutdown.
   */
  unregisterAll(): void {
    for (const [, tool] of this.registeredTools) {
      try { tool.remove(); } catch { /* ignore */ }
    }
    for (const [, resource] of this.registeredResources) {
      try { resource.remove(); } catch { /* ignore */ }
    }
    for (const [, prompt] of this.registeredPrompts) {
      try { prompt.remove(); } catch { /* ignore */ }
    }
    this.registeredTools.clear();
    this.registeredResources.clear();
    this.registeredPrompts.clear();
    this._stats = { tools: 0, resources: 0, prompts: 0, errors: 0 };
    log.info('unregistered all mirrored items');
  }
}

// ─── Export converter for testing ─────────────────────────────────

export { jsonSchemaToZod, jsonSchemaToShape };
