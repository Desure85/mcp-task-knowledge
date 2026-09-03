/**
 * mcp-benchmark-adapter.spec.ts — unit tests for the real-instance benchmark adapter (NEXT2-007).
 * Uses a fake BenchmarkMCPClient; no server required.
 */

import { describe, it, expect } from 'vitest';
import {
  MCPMemoryAdapter,
  selectSuites,
  type BenchmarkMCPClient,
} from '../src/memory/mcp-benchmark-adapter.js';

function envelope(data: unknown): { content: [{ type: string; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function makeFake(calls: Array<{ name: string; args: unknown }>): BenchmarkMCPClient & { calls: typeof calls } {
  return {
    calls,
    async callTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
      calls.push({ name, args });
      if (name === 'knowledge_bulk_create') {
        return envelope({ count: 1, created: [{ id: 'doc-1', title: 't', content: 'c' }] });
      }
      if (name === 'search_knowledge') {
        return envelope([
          { id: 'doc-1', score: 2.5, item: { id: 'doc-1', title: 'T', content: 'Alice prefers TypeScript', tags: ['preference'] } },
          { id: 'doc-2', score: 0.3, item: { id: 'doc-2', title: 'U', content: 'unrelated' } },
        ]);
      }
      if (name === 'knowledge_get') {
        return envelope({ id: 'doc-1', title: 'T', content: 'Alice prefers TypeScript' });
      }
      return envelope({});
    },
  };
}

describe('MCPMemoryAdapter', () => {
  it('add() calls knowledge_bulk_create in the current project and returns the id', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const adapter = new MCPMemoryAdapter(makeFake(calls), { baseProject: 'bench' });
    const id = await adapter.add({ content: 'Alice prefers TypeScript', title: 'fact', tags: ['preference'] });
    expect(id).toBe('doc-1');
    expect(calls[0].name).toBe('knowledge_bulk_create');
    expect(calls[0].args).toMatchObject({ project: 'bench-0' });
  });

  it('search() maps server hits ({id, score, item}) to BenchmarkResult[]', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const adapter = new MCPMemoryAdapter(makeFake(calls));
    const results = await adapter.search('What does Alice prefer?', { limit: 10 });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'doc-1', content: 'Alice prefers TypeScript', score: 2.5 });
    expect(calls[0].args).toMatchObject({ query: 'What does Alice prefer?', limit: 10 });
  });

  it('clear() rotates the project so suites are isolated', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const adapter = new MCPMemoryAdapter(makeFake(calls), { baseProject: 'bench' });
    expect(adapter.project).toBe('bench-0');
    await adapter.clear();
    expect(adapter.project).toBe('bench-1');
    await adapter.add({ content: 'x' });
    expect(calls[0].args).toMatchObject({ project: 'bench-1' });
  });

  it('get() returns the doc; returns null when the tool fails', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const adapter = new MCPMemoryAdapter(makeFake(calls));
    const doc = await adapter.get('doc-1');
    expect(doc).toMatchObject({ id: 'doc-1', content: 'Alice prefers TypeScript' });

    const failing: BenchmarkMCPClient = {
      async callTool() {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { message: 'nope' } }) }] };
      },
    };
    expect(await new MCPMemoryAdapter(failing).get('missing')).toBeNull();
  });
});

describe('selectSuites', () => {
  it('resolves "all" to the 4 suites in order', () => {
    expect(selectSuites('all').map((s) => s.name)).toEqual(['LOCOMO', 'LongMemEval', 'BEAM', 'DMR']);
  });

  it('resolves single suites case-insensitively with aliases', () => {
    expect(selectSuites('locomo').map((s) => s.name)).toEqual(['LOCOMO']);
    expect(selectSuites('LME').map((s) => s.name)).toEqual(['LongMemEval']);
    expect(selectSuites('beam,dmr').map((s) => s.name)).toEqual(['BEAM', 'DMR']);
  });

  it('throws listing valid values for unknown suites', () => {
    expect(() => selectSuites('nope')).toThrow(/unknown benchmark suite.*Valid:/);
  });
});
