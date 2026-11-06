/**
 * OpenAPI generation — tests the REAL module (`src/register/openapi.ts`).
 *
 * History: this file used to define its own copy of `zodToOpenApi` /
 * `convertZodToOpenApi` and assert against that copy. Production code could
 * break freely and the suite stayed green (TR-04 audit, MOCK-DRIFT).
 * Everything below imports the shipped functions and calls them through a
 * real `ToolRegistry`.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import { ToolRegistry } from '../src/registry/tool-registry.js';
import { generateOpenAPISpec, createOpenAPIHandler } from '../src/register/openapi.js';
import type { ServerContext } from '../src/register/context.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeCtx(reg: ToolRegistry): ServerContext {
  // generateOpenAPISpec/createOpenAPIHandler only touch toolRegistry.
  return { toolRegistry: reg } as unknown as ServerContext;
}

function specFor(
  tools: Array<{ name: string; meta: Record<string, unknown> }>,
): Record<string, any> {
  const reg = new ToolRegistry();
  for (const t of tools) reg.set(t.name, t.meta as never);
  return generateOpenAPISpec(makeCtx(reg));
}

interface FakeRes {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  writeHead(code: number, headers?: Record<string, string>): void;
  end(chunk?: string): void;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      if (headers) Object.assign(this.headers, headers);
    },
    end(chunk) {
      if (typeof chunk === 'string') this.body = chunk;
    },
  };
  return res;
}

async function request(
  ctx: ServerContext,
  method: string,
  url: string,
): Promise<FakeRes> {
  const handler = createOpenAPIHandler(ctx);
  const res = makeRes();
  await handler(
    { method, url, headers: { host: 'localhost' } } as never,
    res as never,
  );
  return res;
}

// ─── Spec envelope and meta endpoints ─────────────────────────────────

describe('generateOpenAPISpec — spec envelope', () => {
  it('emits the documented OpenAPI envelope, servers and tag catalogue', () => {
    const spec = specFor([{ name: 'tasks_list', meta: { title: 'List Tasks' } }]);

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('MCP Task & Knowledge API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.license).toEqual({ name: 'MIT', url: 'https://opensource.org/licenses/MIT' });
    expect(spec.servers).toEqual([
      {
        url: 'http://localhost:3001',
        description: 'Local development (MCP_TRANSPORT=http, MCP_PORT=3001)',
      },
    ]);
    const tagNames = spec.tags.map((t: { name: string }) => t.name);
    expect(tagNames).toContain('Tasks');
    expect(tagNames).toContain('Knowledge');
    expect(tagNames).toContain('Auth');
  });

  it('always exposes the meta and auth endpoints', () => {
    const spec = specFor([]);

    expect(spec.paths['/api/tools'].get.operationId).toBe('listTools');
    expect(
      spec.paths['/api/tools'].get.responses['200'].content['application/json'].schema.properties.tools.type,
    ).toBe('array');
    expect(spec.paths['/api/openapi.json'].get.operationId).toBe('getOpenAPISpec');

    const login = spec.paths['/auth/login'].post;
    expect(login.operationId).toBe('login');
    expect(login.requestBody.required).toBe(true);
    expect(login.requestBody.content['application/json'].schema.required).toEqual([
      'username',
      'password',
    ]);
    expect(Object.keys(login.requestBody.content['application/json'].schema.properties)).toEqual([
      'username',
      'password',
    ]);
    expect(Object.keys(login.responses).sort()).toEqual(['200', '400', '401', '429', '503']);
  });
});

// ─── Tool endpoints ───────────────────────────────────────────────────

describe('generateOpenAPISpec — tool endpoints', () => {
  it('exposes one POST path per titled tool and skips untitled ones', () => {
    const spec = specFor([
      { name: 'tasks_list', meta: { title: 'List Tasks', description: 'List tasks' } },
      { name: 'tasks_create', meta: { title: 'Create Task' } },
      { name: 'hidden_tool', meta: {} },
    ]);

    const toolPaths = Object.keys(spec.paths).filter((p) => p.startsWith('/api/tools/'));
    expect(toolPaths.sort()).toEqual(['/api/tools/tasks_create', '/api/tools/tasks_list']);
    expect(spec.paths['/api/tools/hidden_tool']).toBeUndefined();

    const list = spec.paths['/api/tools/tasks_list'].post;
    expect(list.operationId).toBe('tasks_list');
    expect(list.summary).toBe('List Tasks');
    expect(list.description).toBe('List tasks');
    expect(list.responses['200'].description).toBe('Successful response');

    // No description on the tool → empty string, not "undefined".
    expect(spec.paths['/api/tools/tasks_create'].post.description).toBe('');
  });

  it('builds requestBody only when the tool declares an input schema', () => {
    const spec = specFor([
      { name: 'with_schema', meta: { title: 'With schema', inputSchema: { title: z.string() } } },
      { name: 'without_schema', meta: { title: 'Without schema' } },
    ]);

    const withSchema = spec.paths['/api/tools/with_schema'].post;
    expect(withSchema.requestBody.required).toBe(true);
    expect(withSchema.requestBody.content['application/json'].schema).toBeDefined();

    expect(spec.paths['/api/tools/without_schema'].post.requestBody).toBeUndefined();
  });

  it('groups tools into the documented tags', () => {
    const cases: Array<[string, string]> = [
      ['tasks_list', 'Tasks'],
      ['tasks_bulk_create', 'Bulk'],
      ['knowledge_list', 'Knowledge'],
      ['knowledge_bulk_update', 'Bulk'],
      ['search_knowledge', 'Search'],
      ['embeddings_status', 'Search'],
      ['project_list', 'Project'],
      ['obsidian_export_project', 'Obsidian'],
      ['prompts_list', 'Prompts'],
      ['graph_export_mermaid', 'Prompts'],
      ['service_catalog_query', 'Catalog'],
      ['tools_list', 'Introspection'],
      ['tool_help', 'Introspection'],
      ['mcp_authenticate', 'Other'],
    ];

    for (const [name, tag] of cases) {
      const spec = specFor([{ name, meta: { title: name } }]);
      expect(spec.paths[`/api/tools/${name}`].post.tags, name).toEqual([tag]);
    }
  });
});

// ─── Zod → JSON Schema conversion (real converter) ────────────────────

describe('zodToOpenApi — real zod schemas through generateOpenAPISpec', () => {
  function propertiesOf(inputSchema: unknown): {
    properties: Record<string, any>;
    required: string[];
  } {
    const spec = specFor([{ name: 'tool', meta: { title: 'Tool', inputSchema } }]);
    return spec.paths['/api/tools/tool'].post.requestBody.content['application/json'].schema;
  }

  it('converts every supported zod type and computes required', () => {
    const { properties, required } = propertiesOf({
      shape: {
        name: z.string().describe('Task name'),
        count: z.number(),
        active: z.boolean(),
        status: z.enum(['pending', 'done']),
        note: z.string().optional(),
        flag: z.boolean().default(true),
        items: z.array(z.string()),
        literal: z.literal('x'),
        meta: z.record(z.string()),
        choice: z.union([z.string(), z.number()]),
      },
    });

    expect(properties.name).toEqual({ type: 'string', description: 'Task name' });
    expect(properties.count).toEqual({ type: 'number', description: undefined });
    expect(properties.active).toEqual({ type: 'boolean', description: undefined });
    expect(properties.status).toEqual({
      type: 'string',
      enum: ['pending', 'done'],
      description: undefined,
    });
    expect(properties.literal).toEqual({ const: 'x', description: undefined });
    expect(properties.meta).toEqual({
      type: 'object',
      additionalProperties: { type: 'string', description: undefined },
      description: undefined,
    });
    expect(properties.choice).toEqual({
      oneOf: [
        { type: 'string', description: undefined },
        { type: 'number', description: undefined },
      ],
      description: undefined,
    });

    // KNOWN DEFECT (reported, not fixed: TR-04b does not touch src/): the
    // converter reads zod v3 fields `_def.inner` / `_def.element`, but zod v3
    // actually exposes `innerType` / `type`. Wrapped schemas therefore degrade
    // to `{}`. Asserted as-is so this test fails the day the converter is fixed.
    expect(properties.note).toEqual({});
    expect(properties.flag).toEqual({ default: true });
    expect(properties.items).toEqual({ type: 'array', items: {} });

    expect(required).toEqual(['name', 'count', 'active', 'status', 'items', 'literal', 'meta', 'choice']);
  });

  it('passes plain values through and drops nullish properties', () => {
    const { properties } = propertiesOf({
      shape: {
        passthrough: 'literal',
        missing: null,
      },
    });

    expect(properties.passthrough).toBe('literal');
    expect(properties.missing).toBeUndefined();
  });
});

// ─── HTTP surface that actually serves the spec ───────────────────────

describe('createOpenAPIHandler — HTTP routes', () => {
  function ctxWithTools(): ServerContext {
    const reg = new ToolRegistry();
    reg.set('tasks_list', {
      title: 'List Tasks',
      description: 'List tasks',
      inputSchema: { project: z.string().optional() },
    });
    reg.set('hidden_tool', { description: 'no title → not exposed' });
    return makeCtx(reg);
  }

  it('serves the generated spec on GET /api/openapi.json', async () => {
    const res = await request(ctxWithTools(), 'GET', '/api/openapi.json');

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');

    const spec = JSON.parse(res.body);
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.paths['/api/tools/tasks_list'].post.operationId).toBe('tasks_list');
    expect(spec.paths['/api/tools/hidden_tool']).toBeUndefined();
  });

  it('lists titled tools on GET /api/tools', async () => {
    const res = await request(ctxWithTools(), 'GET', '/api/tools');

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.total).toBe(1);
    expect(payload.tools).toHaveLength(1);
    expect(payload.tools[0].name).toBe('tasks_list');
    expect(payload.tools[0].title).toBe('List Tasks');
    expect(payload.tools[0].description).toBe('List tasks');
    expect(payload.tools[0].inputSchema).toHaveProperty('project');
  });

  it('answers the CORS preflight with 204 and CORS headers', async () => {
    const res = await request(ctxWithTools(), 'OPTIONS', '/api/openapi.json');

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(res.body).toBe('');
  });

  it('serves the HTML docs page on /api/docs', async () => {
    const res = await request(ctxWithTools(), 'GET', '/api/docs');

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html');
    expect(res.body).toContain('MCP Task & Knowledge API');
    expect(res.body).toContain('/api/openapi.json');
  });

  it('returns 404 with the available endpoints for unknown paths', async () => {
    const res = await request(ctxWithTools(), 'GET', '/api/nope');

    expect(res.statusCode).toBe(404);
    const payload = JSON.parse(res.body);
    expect(payload.error).toBe('Not found');
    expect(payload.availableEndpoints).toEqual(['/api/docs', '/api/openapi.json', '/api/tools']);
  });
});
