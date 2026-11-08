/**
 * AC-04a — diagnostics for nested tool calls.
 *
 * `tools_run`/`tools_batch` used to reduce a failed inner call to `error.message`, so the
 * original `code`/`hint`/`details` were lost and nothing tied the failure to a server log
 * line. Each inner call now carries `requestId`; `error` stays the message string (existing
 * callers keep working) and `errorEnvelope` holds the original code/message/hint/details.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import { diagnosticsLog, innerFailure } from '../src/core/tools-diagnostics.js';
import { ValidationError } from '../src/core/error-handler.js';
import type { ServerContext } from '../src/register/context.js';

const PROJECT = `ac04a-${Date.now().toString(36)}`;

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
  client = new Client({ name: 'ac04a', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
});

describe('AC-04a: tools_run propagates the inner error envelope', () => {
  it('keeps code, hint and details of a validation refusal and adds requestId', async () => {
    const logged = vi.spyOn(diagnosticsLog, 'warn');
    const run = await call('tools_run', {
      name: 'tasks_create',
      params: { project: PROJECT, title: 'nested', bogus: true },
    });
    expect(run.ok).toBe(true);
    const [entry] = run.data.results;
    expect(entry.ok).toBe(false);
    expect(entry.errorEnvelope.code).toBe('UNKNOWN_PARAM');
    expect(entry.errorEnvelope.message).toContain('tasks_create');
    expect(entry.error).toBe(entry.errorEnvelope.message);
    expect(entry.errorEnvelope.hint).toContain('Allowed arguments');
    expect(entry.errorEnvelope.details.unknown).toEqual(['bogus']);
    expect(typeof entry.requestId).toBe('string');
    expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // `error` is still the plain message, so pre-AC-04a callers keep working.
    // AC-04a: the same id reaches the server log, so an operator can find the line.
    expect(logged).toHaveBeenCalled();
    const loggedLine = logged.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(loggedLine.requestId).toBe(entry.requestId);
    expect(loggedLine.tool).toBe('tasks_create');
    expect(loggedLine.code).toBe('UNKNOWN_PARAM');
    logged.mockRestore();
  });

  it('returns requestId on success too', async () => {
    const run = await call('tools_run', {
      name: 'tasks_create',
      params: { project: PROJECT, title: 'nested ok' },
    });
    const [entry] = run.data.results;
    expect(entry.ok).toBe(true);
    expect(entry.data.title).toBe('nested ok');
    expect(typeof entry.requestId).toBe('string');
    expect(entry.error).toBeUndefined();
    expect(entry.errorEnvelope).toBeUndefined();
  });

  it('reports an unknown inner tool with a code and a hint', async () => {
    const run = await call('tools_run', { name: 'definitely_not_a_tool', params: {} });
    const [entry] = run.data.results;
    expect(entry.ok).toBe(false);
    expect(entry.errorEnvelope.code).toBe('TOOL_NOT_FOUND');
    expect(entry.errorEnvelope.hint).toContain('tools_list');
    expect(typeof entry.requestId).toBe('string');
  });

  it('keeps stopOnError semantics', async () => {
    const run = await call('tools_run', {
      items: [
        { name: 'definitely_not_a_tool', params: {} },
        { name: 'tasks_create', params: { project: PROJECT, title: 'should not run' } },
      ],
      stopOnError: true,
    });
    expect(run.data.results).toHaveLength(1);
    expect(run.data.results[0].errorEnvelope.code).toBe('TOOL_NOT_FOUND');
  });
});

describe('AC-04a: tools_batch has the same diagnostics', () => {
  it('keeps the inner error envelope and a requestId per call', async () => {
    const batch = await call('tools_batch', {
      items: [
        { name: 'tasks_create', params: { project: PROJECT, title: 'batch ok' } },
        { name: 'tasks_list', params: { project: PROJECT, tags: ['x'] } },
      ],
    });
    expect(batch.ok).toBe(true);
    expect(batch.data.parallel).toBe(true);
    const [okEntry, failed] = batch.data.results;
    expect(okEntry.ok).toBe(true);
    expect(typeof okEntry.requestId).toBe('string');

    expect(failed.ok).toBe(false);
    expect(failed.errorEnvelope.code).toBe('UNKNOWN_PARAM');
    expect(failed.errorEnvelope.details.unknown).toEqual(['tags']);
    expect(typeof failed.requestId).toBe('string');
    expect(okEntry.requestId).not.toBe(failed.requestId);
  });
});

describe('AC-04d: nested params are validated against the tool schema', () => {
  it('refuses tasks_create without title and writes no task file', async () => {
    const project = `${PROJECT}-novalid`;
    const run = await call('tools_run', { name: 'tasks_create', params: { project } });

    expect(run.ok).toBe(true);
    const [entry] = run.data.results;
    expect(entry.ok).toBe(false);
    expect(entry.errorEnvelope.code).toBe('VALIDATION_ERROR');
    expect(entry.errorEnvelope.message).toContain('title');
    expect(entry.errorEnvelope.hint).toContain('tool_schema');
    expect(entry.errorEnvelope.details.issues.map((issue: { path: string }) => issue.path)).toContain('title');
    expect(entry.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const dir = path.join(process.env.DATA_DIR!, 'tasks', project);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toHaveLength(0);
    const list = await call('tasks_list', { project });
    expect(list.total).toBe(0);
  });

  it('reports the nested array path for tasks_bulk_create items:[{}]', async () => {
    const run = await call('tools_run', {
      name: 'tasks_bulk_create',
      params: { project: `${PROJECT}-bulk`, items: [{}] },
    });

    const [entry] = run.data.results;
    expect(entry.ok).toBe(false);
    expect(entry.errorEnvelope.code).toBe('VALIDATION_ERROR');
    expect(entry.errorEnvelope.details.issues.map((issue: { path: string }) => issue.path)).toContain(
      'items[0].title',
    );
  });

  it('tools_batch validates params the same way and creates nothing', async () => {
    const project = `${PROJECT}-batchnovalid`;
    const batch = await call('tools_batch', {
      items: [{ name: 'tasks_create', params: { project } }],
    });

    const [entry] = batch.data.results;
    expect(entry.ok).toBe(false);
    expect(entry.errorEnvelope.code).toBe('VALIDATION_ERROR');
    const dir = path.join(process.env.DATA_DIR!, 'tasks', project);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toHaveLength(0);
  });

  it('keeps the tool code of a thrown classified error', () => {
    const failure = innerFailure('probe', new ValidationError('bad input', { code: 'TASK_INVALID' }));
    expect(failure.errorEnvelope?.code).toBe('TASK_INVALID');
    expect(failure.error).toBe('bad input');
  });
});
