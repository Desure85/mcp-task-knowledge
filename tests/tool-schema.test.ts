/**
 * AC-04b — `tool_schema` publishes a real JSON Schema.
 *
 * Before the change `tool_schema(name)` returned the registry's raw Zod shape: JSON-serialised it
 * is `_def`/`_zod` internals, so the only usable part was `example` — with the `"example"` stub for
 * non-scalar arguments. The handler now converts the shape with the SDK's own schema converter and
 * keeps the stub strictly inside `example`.
 *
 * The fallback (SDK internal converter unavailable) is covered directly, because the whole point of
 * the fallback is that an SDK upgrade cannot silently degrade the published schema.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z as z3 } from 'zod/v3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import { readInputShape } from '../src/core/tool-arguments.js';
import { jsonSchemaForTool, minimalInputSchema } from '../src/core/tool-schema.js';
import type { ServerContext } from '../src/register/context.js';

let ctx: ServerContext;
let client: Client;

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(((res?.content as any)?.[0]?.text as string) ?? '{}');
}

beforeAll(async () => {
  ctx = await createServerContext();
  await defaultRegistration(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await ctx.server.connect(serverTransport);
  client = new Client({ name: 'ac04b', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
});

describe('AC-04b: tool_schema publishes a real JSON Schema', () => {
  it('exposes the nested items schema of tasks_bulk_create', async () => {
    const schema = await call('tool_schema', { name: 'tasks_bulk_create' });
    expect(schema.ok).toBe(true);

    const items = schema.data.inputSchema?.properties?.items;
    expect(items?.type).toBe('array');
    expect(items?.items?.properties?.title?.type).toBe('string');
    expect(items?.items?.properties?.parentId).toBeDefined();
    expect(schema.data.inputSchema.required).toContain('items');

    // The stub survives only inside the human-friendly example.
    expect(schema.data.example.items).toBe('example');
    expect(JSON.stringify(schema.data.inputSchema)).not.toContain('"example"');
  });

  it('agrees with the protocol tools/list schema', async () => {
    const listed = await client.listTools();
    const published = listed.tools.find((tool) => tool.name === 'tasks_bulk_create');
    const schema = await call('tool_schema', { name: 'tasks_bulk_create' });

    expect([...(schema.data.inputSchema.required ?? [])].sort()).toEqual(
      [...((published?.inputSchema?.required as string[] | undefined) ?? [])].sort(),
    );
    expect(Object.keys(schema.data.inputSchema.properties).sort()).toEqual(
      Object.keys((published?.inputSchema?.properties as Record<string, unknown>) ?? {}).sort(),
    );
  });

  it('covers every registered tool without throwing', async () => {
    const listed = await client.listTools();
    const failures: string[] = [];
    for (const tool of listed.tools) {
      const schema = await call('tool_schema', { name: tool.name });
      if (!schema.ok) failures.push(`${tool.name}: ${schema.error?.message ?? 'error'}`);
      else if (schema.data.inputSchema && schema.data.inputSchema.type !== 'object') {
        failures.push(`${tool.name}: ${JSON.stringify(schema.data.inputSchema).slice(0, 80)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('AC-04b: fallback schema when the SDK converter is unavailable', () => {
  it('keeps property names and the required list', () => {
    const shape = readInputShape({
      project: z3.string().optional(),
      items: z3.array(z3.object({ title: z3.string() })),
    });
    expect(shape).toBeDefined();
    const fallback = minimalInputSchema(shape!);
    expect(fallback.type).toBe('object');
    expect(Object.keys(fallback.properties as Record<string, unknown>).sort()).toEqual(['items', 'project']);
    expect(fallback.required).toEqual(['items']);
    expect(fallback['x-schema-source']).toBe('fallback');
  });

  it('converts a v3 shape through the SDK converter end to end', async () => {
    const shape = readInputShape({ title: z3.string().min(1), tags: z3.array(z3.string()).optional() });
    const schema = await jsonSchemaForTool(shape);
    expect(schema?.type).toBe('object');
    expect((schema?.properties as Record<string, any>).title.type).toBe('string');
    expect(schema?.required).toEqual(['title']);
  });
});
