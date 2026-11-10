import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import {
  MAX_SERVER_INSTRUCTION_LINES,
  buildServerInstructions,
  setServerInstructions,
  toolDomains,
} from '../src/core/server-instructions.js';

function lineCount(text: string): number {
  return text.split('\n').length;
}

describe('CM-03: generated server instructions', () => {
  it('derives domains and counts from tool names and keeps the protocol', () => {
    const tools = [
      { name: 'tasks_list' }, { name: 'tasks_create' }, { name: 'tasks_update' },
      { name: 'knowledge_list' }, { name: 'knowledge_get' },
      { name: 'memory_recall' },
      { name: 'tools_list' }, { name: 'tools_run' },
      { name: 'mcp.authenticate' },
    ];
    expect(toolDomains(tools)).toEqual([
      { domain: 'tasks', count: 3 },
      { domain: 'knowledge', count: 2 },
      { domain: 'tools', count: 2 },
      { domain: 'mcp', count: 1 },
      { domain: 'memory', count: 1 },
    ].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)));
    const text = buildServerInstructions(tools);
    expect(text).toContain('tools_list');
    expect(text).toContain('tool_schema');
    expect(text).toContain('tools_run');
    expect(text).toContain('tools_batch');
    expect(text).toContain('tasks 3');
    expect(text).toContain('knowledge 2');
    expect(text).toContain('mcp 1');
    expect(lineCount(text)).toBeLessThanOrEqual(MAX_SERVER_INSTRUCTION_LINES);
  });

  it('never exceeds 15 lines for a large registry', () => {
    const tools = Array.from({ length: 60 }, (_, index) => ({ name: `domain${index}_tool` }));
    const text = buildServerInstructions(tools);
    expect(lineCount(text)).toBeLessThanOrEqual(MAX_SERVER_INSTRUCTION_LINES);
  });
});

describe('CM-03: initialize exposes instructions', () => {
  it('returns a non-empty, short instruction with every live domain and its count', async () => {
    const ctx = await createServerContext();
    await defaultRegistration(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'cm03-client', version: '0.0.1' });
    try {
      await ctx.server.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions();
      expect(instructions).toBeTruthy();
      expect(lineCount(instructions!)).toBeLessThanOrEqual(MAX_SERVER_INSTRUCTION_LINES);
      expect(instructions).toContain('tools_list');
      expect(instructions).toContain('tool_schema');
      expect(instructions).toContain('tools_run');

      const tools = ctx.toolRegistry.list({ limit: 300 }).data.map((tool) => ({ name: tool.name }));
      for (const { domain, count } of toolDomains(tools)) {
        expect(instructions).toContain(`${domain} ${count}`);
      }
    } finally {
      await client.close().catch(() => undefined);
      await ctx.server.close().catch(() => undefined);
    }
  });

  it('setServerInstructions writes through to the low-level server', async () => {
    const ctx = await createServerContext();
    try {
      setServerInstructions(ctx.server, 'custom instructions');
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'cm03-setter', version: '0.0.1' });
      await ctx.server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(client.getInstructions()).toBe('custom instructions');
      await client.close();
    } finally {
      await ctx.server.close().catch(() => undefined);
    }
  });
});
