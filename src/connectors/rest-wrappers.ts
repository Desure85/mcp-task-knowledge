/**
 * connectors/rest-wrappers.ts — REST endpoint generation from MCP tools (INT-005)
 *
 * Generates OpenAPI 3.1 spec from registered MCP tools and provides
 * a middleware that maps HTTP GET/POST to tool invocations.
 * This lets non-MCP clients (curl, Postman, web apps) call tools via REST.
 */

import type { ToolRegistry } from '../registry/tool-registry.js';

export interface OpenApiSpec {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  paths: Record<string, {
    get?: OpenApiOperation;
    post?: OpenApiOperation;
  }>;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: 'query' | 'path';
    required?: boolean;
    schema: { type: string };
    description?: string;
  }>;
  requestBody?: {
    content: { 'application/json': { schema: Record<string, unknown> } };
  };
  responses: {
    '200': { description: string; content: { 'application/json': { schema: Record<string, unknown> } } };
  };
}

/**
 * Generate an OpenAPI 3.1 spec from the tool registry.
 * Each tool becomes a POST /api/tools/{name} endpoint.
 */
export function generateOpenApiSpec(registry: ToolRegistry, title = 'mcp-task-knowledge', version = '1.0.0'): OpenApiSpec {
  const tools = registry.list({ offset: 0, limit: 100 });
  const paths: OpenApiSpec['paths'] = {};

  for (const tool of tools.data) {
    const path = `/api/tools/${tool.name}`;
    const inputKeys = tool.inputKeys ?? [];

    paths[path] = {
      post: {
        operationId: tool.name,
        summary: tool.title ?? tool.name,
        description: tool.description ?? '',
        requestBody: inputKeys.length > 0 ? {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: Object.fromEntries(inputKeys.map((k) => [k, { type: 'string' }])),
              },
            },
          },
        } : undefined,
        responses: {
          '200': {
            description: 'Tool result',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title, version, description: 'Auto-generated from MCP tool registry (INT-005)' },
    paths,
  };
}

/**
 * REST handler: maps an HTTP request to a tool invocation.
 * POST /api/tools/{name} with JSON body → tool handler({ ...body })
 */
export interface RestHandlerResult {
  status: number;
  body: unknown;
}

export async function handleRestRequest(
  registry: ToolRegistry,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<RestHandlerResult> {
  if (method !== 'POST') {
    return { status: 405, body: { ok: false, error: { message: 'Method not allowed, use POST' } } };
  }

  const match = path.match(/^\/api\/tools\/(.+)$/);
  if (!match) {
    return { status: 404, body: { ok: false, error: { message: 'Not found' } } };
  }

  const toolName = match[1];
  const meta = registry.get(toolName);
  if (!meta || typeof meta.handler !== 'function') {
    return { status: 404, body: { ok: false, error: { message: `Tool not found: ${toolName}` } } };
  }

  try {
    const result = await meta.handler(body);
    return { status: 200, body: result };
  } catch (e) {
    return { status: 500, body: { ok: false, error: { message: (e as Error).message } } };
  }
}
