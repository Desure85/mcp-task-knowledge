import type { ServerContext } from './context.js';

/**
 * Generate an OpenAPI 3.0 specification from the registered MCP tools.
 * Each tool is exposed as a POST /api/tools/{toolName} endpoint.
 */
export function generateOpenAPISpec(ctx: ServerContext): Record<string, any> {
  const tools = Array.from(ctx.toolRegistry.entries())
    .map(([name, meta]) => ({ name, ...meta }))
    .filter(t => t.title); // only tools with metadata

  // Collect all property schemas to build reusable components
  const paths: Record<string, any> = {};

  for (const tool of tools) {
    const path = `/api/tools/${tool.name}`;
    paths[path] = {
      post: {
        operationId: tool.name,
        summary: tool.title || tool.name,
        description: tool.description || '',
        requestBody: tool.inputSchema
          ? {
              required: true,
              content: {
                'application/json': {
                  schema: zodToOpenApi(tool.inputSchema),
                },
              },
            }
          : undefined,
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', description: 'Whether the call succeeded' },
                    data: { type: 'object', description: 'Response payload' },
                    error: { type: 'object', description: 'Error details (when ok=false)' },
                  },
                },
              },
            },
          },
        },
        tags: categorizeTool(tool.name),
      },
    };
  }

  // Root endpoint
  paths['/api/tools'] = {
    get: {
      operationId: 'listTools',
      summary: 'List all MCP tools',
      description: 'Returns all registered MCP tools with their names, descriptions, and input schemas.',
      tags: ['Meta'],
      responses: {
        '200': {
          description: 'List of tools',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tools: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        inputSchema: { type: 'object' },
                      },
                    },
                  },
                  total: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  };

  paths['/api/openapi.json'] = {
    get: {
      operationId: 'getOpenAPISpec',
      summary: 'OpenAPI specification',
      description: 'Returns the OpenAPI 3.0 specification for this API.',
      tags: ['Meta'],
      responses: {
        '200': {
          description: 'OpenAPI 3.0 JSON',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'MCP Task & Knowledge API',
      description: 'REST API for the mcp-task-knowledge MCP server. Tools are exposed as POST endpoints. Built-in MCP tools are grouped by category.',
      version: '1.0.0',
      contact: {
        name: 'Desure85',
        url: 'https://github.com/Desure85/mcp-task-knowledge',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Local development (MCP_TRANSPORT=http, MCP_PORT=3001)',
      },
    ],
    tags: [
      { name: 'Tasks', description: 'Task management: create, update, close, list, hierarchy' },
      { name: 'Knowledge', description: 'Knowledge base: documents, tags, types' },
      { name: 'Search', description: 'Full-text search (BM25 + vector)' },
      { name: 'Bulk', description: 'Batch operations for tasks and knowledge' },
      { name: 'Project', description: 'Project management and switching' },
      { name: 'Obsidian', description: 'Import/export from Obsidian vaults' },
      { name: 'Dependencies', description: 'Task dependency graph (DAG)' },
      { name: 'Prompts', description: 'Prompt library, A/B experiments, workflow builds' },
      { name: 'Catalog', description: 'Service catalog query and management' },
      { name: 'Introspection', description: 'Tool discovery and batch execution' },
      { name: 'Meta', description: 'API meta-information and documentation' },
    ],
    paths,
  };
}

/**
 * Serve the OpenAPI spec and a Swagger UI redirect.
 * Adds /api/openapi.json and /api/docs routes to the HTTP server.
 */
export function createOpenAPIHandler(ctx: ServerContext) {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // CORS headers
    const setCors = () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    };

    if (req.method === 'OPTIONS') {
      setCors();
      res.writeHead(204);
      res.end();
      return;
    }

    setCors();

    if (path === '/api/openapi.json') {
      const spec = generateOpenAPISpec(ctx);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(spec, null, 2));
      return;
    }

    if (path === '/api/tools' && req.method === 'GET') {
      const tools = Array.from(ctx.toolRegistry.entries())
        .map(([name, meta]) => ({
          name,
          title: meta.title,
          description: meta.description,
          inputSchema: meta.inputSchema,
        }))
        .filter(t => t.title);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools, total: tools.length }, null, 2));
      return;
    }

    if (path === '/api/docs') {
      // Redirect to Swagger UI or render a simple docs page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>MCP Task & Knowledge — API Docs</title>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f8f9fa; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #4361ee; padding-bottom: 10px; }
    h2 { color: #4361ee; margin-top: 30px; }
    .tool { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .tool-name { font-family: monospace; font-size: 14px; color: #4361ee; font-weight: bold; }
    .tool-desc { color: #666; margin-top: 4px; }
    .tag { display: inline-block; background: #4361ee; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 12px; margin-right: 6px; }
    a { color: #4361ee; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #888; font-size: 13px; margin-top: 20px; }
    .endpoint { font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>MCP Task & Knowledge API</h1>
  <p>OpenAPI spec: <a href="/api/openapi.json">/api/openapi.json</a></p>
  <p>Tools list: <a href="/api/tools">/api/tools</a></p>
  <h2>Endpoints</h2>
  <div class="tool">
    <div class="tool-name">GET /api/tools</div>
    <div class="tool-desc">List all registered MCP tools with schemas</div>
  </div>
  <div class="tool">
    <div class="tool-name">GET /api/openapi.json</div>
    <div class="tool-desc">OpenAPI 3.0 specification (JSON)</div>
  </div>
  <div class="tool">
    <div class="tool-name">POST /api/tools/{toolName}</div>
    <div class="tool-desc">Execute any MCP tool by name. Body = tool input parameters (JSON).</div>
  </div>
  <h2>Categories</h2>
  <div class="tool"><span class="tag">Tasks</span> tasks_list, tasks_create, tasks_update, tasks_close, tasks_tree, tasks_add_subtask, tasks_get_subtree, tasks_get_children</div>
  <div class="tool"><span class="tag">Knowledge</span> knowledge_list, knowledge_tree, knowledge_get</div>
  <div class="tool"><span class="tag">Search</span> search_tasks, search_knowledge, embeddings_status</div>
  <div class="tool"><span class="tag">Bulk</span> tasks_bulk_create/update/close/archive/trash/restore, knowledge_bulk_create/update/archive/trash/restore</div>
  <div class="tool"><span class="tag">Dependencies</span> tasks_set_deps, tasks_get_deps, tasks_dag</div>
  <div class="tool"><span class="tag">Project</span> project_list, project_get_current, project_set_current, project_purge</div>
  <div class="tool"><span class="tag">Obsidian</span> obsidian_export_project, obsidian_import_project</div>
  <div class="tool"><span class="tag">Prompts</span> prompts_list, prompts_search, prompts_build, prompts_feedback_log, prompts_ab_report, and more</div>
  <div class="tool"><span class="tag">Catalog</span> service_catalog_query, service_catalog_health, service_catalog_upsert, service_catalog_delete</div>
  <div class="tool"><span class="tag">Introspection</span> tools_list, tool_schema, tool_help, tools_run</div>
  <p class="meta">MCP Task & Knowledge v1.0.0 &middot; MIT License</p>
</body>
</html>`);
      return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', availableEndpoints: ['/api/docs', '/api/openapi.json', '/api/tools'] }));
  };
}

/**
 * Categorize a tool name into an OpenAPI tag.
 */
function categorizeTool(name: string): string[] {
  if (name.startsWith('tasks_') && !name.startsWith('tasks_bulk')) return ['Tasks'];
  if (name.startsWith('tasks_bulk') || name.startsWith('knowledge_bulk')) return ['Bulk'];
  if (name.startsWith('knowledge_')) return ['Knowledge'];
  if (name.startsWith('search_') || name.startsWith('embeddings_')) return ['Search'];
  if (name.startsWith('project_')) return ['Project'];
  if (name.startsWith('obsidian_')) return ['Obsidian'];
  if (name.startsWith('tasks_set_deps') || name.startsWith('tasks_get_deps') || name.startsWith('tasks_dag')) return ['Dependencies'];
  if (name.startsWith('prompts_') || name.startsWith('graph_')) return ['Prompts'];
  if (name.startsWith('service_catalog_')) return ['Catalog'];
  if (name.startsWith('tools_') || name.startsWith('tool_')) return ['Introspection'];
  return ['Other'];
}

/**
 * Convert a zod-like input schema (as stored in toolRegistry) to OpenAPI JSON Schema format.
 * The SDK stores zod schemas; we convert the known patterns to JSON Schema.
 */
function zodToOpenApi(schema: Record<string, any>): any {
  if (!schema || typeof schema !== 'object') return {};

  // If it has _def (zod ZodObject), convert its shape
  const shape = schema._def?.shape || schema.shape;
  if (!shape) {
    // Might already be a plain object schema or a zod schema we can introspect
    if (schema._def) {
      return convertZodToOpenApi(schema);
    }
    // Fallback: treat as-is
    return schema;
  }

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, val] of Object.entries(shape)) {
    const openApiProp = convertZodToOpenApi(val as any);
    if (openApiProp) {
      properties[key] = openApiProp;
      // Check if optional
      const v = val as any;
      if (v._def?.typeName !== 'ZodOptional' && !v.isOptional?.()) {
        if (v._def?.typeName !== 'ZodDefault') {
          required.push(key);
        }
      }
    }
  }

  return { type: 'object', properties, required };
}

/**
 * Convert a Zod schema to OpenAPI JSON Schema.
 */
function convertZodToOpenApi(zodSchema: any): any {
  if (!zodSchema || !zodSchema._def) return zodSchema;

  const def = zodSchema._def;

  switch (def.typeName) {
    case 'ZodString':
      return { type: 'string', description: def.description };
    case 'ZodNumber':
      return { type: 'number', description: def.description };
    case 'ZodBoolean':
      return { type: 'boolean', description: def.description };
    case 'ZodArray':
      return {
        type: 'array',
        items: def.element ? convertZodToOpenApi(def.element) : {},
        description: def.description,
      };
    case 'ZodEnum':
      return { type: 'string', enum: def.values, description: def.description };
    case 'ZodOptional':
      return def.inner ? convertZodToOpenApi(def.inner) : {};
    case 'ZodDefault':
      return {
        ...convertZodToOpenApi(def.inner),
        default: def.defaultValue(),
      };
    case 'ZodObject':
      return zodToOpenApi(zodSchema);
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: def.valueType ? convertZodToOpenApi(def.valueType) : {},
        description: def.description,
      };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return {
        oneOf: (def.options || []).map((o: any) => convertZodToOpenApi(o)),
        description: def.description,
      };
    case 'ZodLiteral':
      return { const: def.value, description: def.description };
    default:
      return { type: 'string', description: def.description || '' };
  }
}
