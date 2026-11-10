/**
 * CM-01: контракт ТЕКУЩЕГО поведения tools_run и tools_batch.
 *
 * Фиксирует то, что уже реализовано (не меняет поведение): порядок результатов = порядку items;
 * обычная ошибка в середине пачки не останавливает цикл; stopOnError прекращает его; tools_batch
 * параллелен через Promise.all и не имеет флага остановки. Конкурентность доказывается счётчиком
 * активных обработчиков и барьером, без sleep.
 */

import { describe, it, expect } from 'vitest';
import { registerToolsIntrospection } from '../src/register/tools-introspection.js';
import type { ServerContext } from '../src/register/context.js';

interface FakeTool {
  handler: (params: Record<string, unknown>, extra?: unknown) => Promise<unknown>;
  inputSchema: Record<string, unknown>;
}

function harness() {
  const handlers = new Map<string, (input: Record<string, unknown>, extra?: unknown) => Promise<unknown>>();
  const definitions = new Map<string, { inputSchema: Record<string, unknown> }>();
  const tools = new Map<string, FakeTool>();
  const registry = {
    etag: 'contract',
    get: (name: string) => tools.get(name),
    list: () => [...tools.keys()].map((name) => ({ name })),
  };
  const ctx = {
    server: {
      registerTool: (
        name: string,
        definition: { inputSchema: Record<string, unknown> },
        handler: (input: Record<string, unknown>, extra?: unknown) => Promise<unknown>,
      ) => {
        handlers.set(name, handler);
        definitions.set(name, definition);
      },
    },
    toolRegistry: registry,
    TOOLS_ENABLED: true,
    TOOL_RES_ENABLED: false,
  } as unknown as ServerContext;
  registerToolsIntrospection(ctx);
  const add = (name: string, handler: FakeTool['handler']) => {
    tools.set(name, { handler, inputSchema: {} });
  };
  const call = (name: 'tools_run' | 'tools_batch', input: Record<string, unknown>) => handlers.get(name)!(input);
  return { add, call, definitions, handlers };
}

function payload(result: unknown): { ok: boolean; data: { count: number; results: Array<{ name: string; ok: boolean }>; parallel?: boolean } } {
  const envelope = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}';
  return JSON.parse(envelope) as never;
}

describe('CM-01: tools_run contract', () => {
  it('preserves item order and executes sequentially', async () => {
    const { add, call } = harness();
    let active = 0;
    let maxActive = 0;
    const sequence: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      add(name, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        sequence.push(name);
        await Promise.resolve();
        active -= 1;
        return { ok: true, data: { name } };
      });
    }
    const response = payload(
      await call('tools_run', { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }),
    );
    expect(sequence).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(response.data.count).toBe(3);
    expect(response.data.results.map((entry) => entry.name)).toEqual(['a', 'b', 'c']);
  });

  it('continues after a mid-batch error by default', async () => {
    const { add, call } = harness();
    const executed: string[] = [];
    add('ok1', async () => {
      executed.push('ok1');
      return { ok: true };
    });
    add('ok2', async () => {
      executed.push('ok2');
      return { ok: true };
    });
    const response = payload(
      await call('tools_run', { items: [{ name: 'ok1' }, { name: 'missing' }, { name: 'ok2' }] }),
    );
    expect(executed).toEqual(['ok1', 'ok2']);
    expect(response.data.count).toBe(3);
    expect(response.data.results[1].ok).toBe(false);
    expect(response.data.results[2].ok).toBe(true);
  });

  it('stopOnError stops the loop after the first failure', async () => {
    const { add, call } = harness();
    const executed: string[] = [];
    add('ok1', async () => {
      executed.push('ok1');
      return { ok: true };
    });
    add('ok2', async () => {
      executed.push('ok2');
      return { ok: true };
    });
    const response = payload(
      await call('tools_run', {
        items: [{ name: 'ok1' }, { name: 'missing' }, { name: 'ok2' }],
        stopOnError: true,
      }),
    );
    expect(executed).toEqual(['ok1']);
    expect(response.data.count).toBe(2);
  });
});

describe('CM-01: tools_batch contract', () => {
  it('runs handlers concurrently via Promise.all and keeps item order', async () => {
    const { add, call } = harness();
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let startedCount = 0;
    let allStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    for (const name of ['slow1', 'slow2']) {
      add(name, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        startedCount += 1;
        if (startedCount === 2) allStarted();
        await barrier;
        active -= 1;
        return { ok: true, data: { name } };
      });
    }
    const pending = call('tools_batch', { items: [{ name: 'slow1' }, { name: 'slow2' }] });
    await started;
    release();
    const response = payload(await pending);
    expect(maxActive).toBe(2); // sequential implementations would stop at 1
    expect(response.data.parallel).toBe(true);
    expect(response.data.results.map((entry) => entry.name)).toEqual(['slow1', 'slow2']);
  });

  it('has no stopOnError flag and returns every result for mixed success/failure', async () => {
    const { add, call, definitions } = harness();
    add('ok', async () => ({ ok: true }));
    const definition = definitions.get('tools_batch') as { inputSchema: Record<string, unknown> };
    expect(Object.keys(definition.inputSchema)).toEqual(['items']);
    expect(definition.inputSchema).not.toHaveProperty('stopOnError');

    const schema = definition.inputSchema.items as { safeParse: (value: unknown) => { success: boolean } };
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse(Array.from({ length: 50 }, () => ({ name: 'ok' }))).success).toBe(true);
    expect(schema.safeParse(Array.from({ length: 51 }, () => ({ name: 'ok' }))).success).toBe(false);

    const response = payload(await call('tools_batch', { items: [{ name: 'ok' }, { name: 'missing' }, { name: 'ok' }] }));
    expect(response.data.count).toBe(3);
    expect(response.data.results.map((entry) => entry.ok)).toEqual([true, false, true]);
  });
});
