/**
 * AC-01 — tool argument contracts.
 *
 * Three defects were confirmed on `master` f6a748f (see `BACKLOG.md` AC-01) and fixed here:
 *
 *   1. the published `inputSchema` and the Zod schema must agree on what is required,
 *      otherwise clients copy the published contract and get a validation error (or the
 *      reverse: they send a field the server silently drops);
 *   2. an unknown top-level argument was silently ignored — `tasks_list({ tags: [...] })`
 *      returned every task instead of failing, because the SDK's Zod validation strips
 *      unknown keys before the handler runs;
 *   3. `parentId: ""` was persisted into the task/document file even though every other
 *      "no parent" input is `undefined`/`null`.
 *
 * The test runs the real server context over an in-memory transport, so it exercises the
 * same SDK validation path a client does — not the handlers directly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import { readInputShape } from '../src/core/tool-arguments.js';
import { DATA_DIR } from '../src/config.js';
import type { ServerContext } from '../src/register/context.js';

const PROJECT = `ac01-${Date.now().toString(36)}`;

let ctx: ServerContext;
let client: Client;

async function connect(): Promise<{ ctx: ServerContext; client: Client }> {
  const created = await createServerContext();
  await defaultRegistration(created);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await created.server.connect(serverTransport);
  const createdClient = new Client({ name: 'ac01', version: '0.0.0' });
  await createdClient.connect(clientTransport);
  return { ctx: created, client: createdClient };
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(((res?.content as any)?.[0]?.text as string) ?? '{}');
}

async function readTaskFile(id: string): Promise<Record<string, unknown>> {
  const file = path.join(DATA_DIR, 'tasks', PROJECT, `${id}.json`);
  return JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  const session = await connect();
  ctx = session.ctx;
  client = session.client;
});

afterAll(async () => {
  await client?.close();
});

describe('AC-01: published schema equals Zod optionality', () => {
  it('marks exactly the non-optional fields as required for every registered tool', async () => {
    const listed = await client.listTools();
    const published = new Map(listed.tools.map((tool) => [tool.name, tool]));
    const mismatches: string[] = [];

    for (const [name, meta] of ctx.toolRegistry.entries()) {
      const shape = readInputShape(meta.inputSchema);
      if (!shape) continue;
      const optional = new Set(
        Object.entries(shape)
          .filter(([, schema]) => {
            const typed = schema as { isOptional?: () => boolean; safeParse?: (value: unknown) => { success: boolean } };
            if (typeof typed.isOptional === 'function') return typed.isOptional();
            if (typeof typed.safeParse === 'function') return typed.safeParse(undefined).success;
            return false;
          })
          .map(([key]) => key),
      );
      const expected = Object.keys(shape).filter((key) => !optional.has(key)).sort();
      const tool = published.get(name);
      const actual = [...((tool?.inputSchema?.required as string[] | undefined) ?? [])].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${name}: expected required ${JSON.stringify(expected)}, published ${JSON.stringify(actual)}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('keeps the six bulk tools callable with only their required fields', async () => {
    const create = await call('tasks_bulk_create', { project: PROJECT, items: [{ title: 'bulk root' }] });
    expect(create.ok).toBe(true);
    const id = create.data.created[0].id as string;

    const update = await call('tasks_bulk_update', { project: PROJECT, items: [{ id, title: 'renamed' }] });
    expect(update.ok).toBe(true);

    const docCreate = await call('knowledge_bulk_create', {
      project: PROJECT,
      items: [{ title: 'bulk doc', content: 'body' }],
    });
    expect(docCreate.ok).toBe(true);
    const docId = docCreate.data.created[0].id as string;

    const docUpdate = await call('knowledge_bulk_update', {
      project: PROJECT,
      items: [{ id: docId, title: 'renamed doc' }],
    });
    expect(docUpdate.ok).toBe(true);

    // The four above are the bulk tools whose nested items used to be reported as "all fields
    // required" through the bridge; the remaining bulk tools take `project` + `ids` only and
    // are covered by the minimal-call contract of the schema check above.
    const archive = await call('tasks_bulk_archive', { project: PROJECT, ids: [id] });
    expect(archive.ok).toBe(true);
    const restore = await call('tasks_bulk_restore', { project: PROJECT, ids: [id] });
    expect(restore.ok).toBe(true);
  });
});

describe('AC-01: unknown top-level argument is reported', () => {
  it('rejects tasks_list({ tags }) with UNKNOWN_PARAM and hints at tag', async () => {
    const result = await call('tasks_list', { project: PROJECT, tags: ['x'] });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UNKNOWN_PARAM');
    expect(result.error.message).toContain('tasks_list');
    expect(result.error.message).toContain('"tags"');
    expect(result.error.hint).toContain('"tag"');
    expect(result.error.details).toMatchObject({ unknown: ['tags'], suggestion: 'tag' });
    expect(result.error.details.allowed).toContain('tag');
  });

  it('still accepts the real argument', async () => {
    const result = await call('tasks_list', { project: PROJECT, tag: 'x' });
    expect(result.ok).toBe(true);
    // The paginated envelope keeps the items in data and the page metadata beside it.
    expect(result.data).toEqual([]);
  });

  it('reports every unknown name when there are several', async () => {
    const result = await call('tasks_list', { project: PROJECT, tags: ['x'], bogus: true });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UNKNOWN_PARAM');
    expect(result.error.details.unknown).toEqual(['tags', 'bogus']);
  });
});

describe('AC-01: an empty string means "absent"', () => {
  it('does not persist parentId: "" on create', async () => {
    const created = await call('tasks_bulk_create', {
      project: PROJECT,
      items: [{ title: 'blank parent', parentId: '' }],
    });
    expect(created.ok).toBe(true);
    const id = created.data.created[0].id as string;
    const file = await readTaskFile(id);
    expect(Object.prototype.hasOwnProperty.call(file, 'parentId')).toBe(false);
  });

  it('detaches a task from its parent on update with parentId: ""', async () => {
    const root = await call('tasks_create', { project: PROJECT, title: 'root' });
    const child = await call('tasks_create', {
      project: PROJECT,
      title: 'child',
      parentId: root.data.id,
    });
    expect((await readTaskFile(child.data.id)).parentId).toBe(root.data.id);

    const updated = await call('tasks_update', { project: PROJECT, id: child.data.id, parentId: '' });
    expect(updated.ok).toBe(true);
    const file = await readTaskFile(updated.data.id);
    expect(Object.prototype.hasOwnProperty.call(file, 'parentId')).toBe(false);
  });
});
