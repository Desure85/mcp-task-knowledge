/**
 * framework-adapters.spec.ts — Tests for cross-framework portability adapters.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LangGraphMemoryAdapter,
  AutoGenMemoryAdapter,
  CrewAIMemoryAdapter,
  LangChainMemoryAdapter,
  createAdapter,
  type MCPClient,
} from '../src/memory/framework-adapters.js';

class MockMCPClient implements MCPClient {
  public calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  private responses = new Map<string, unknown>();

  setResponse(tool: string, response: unknown): void {
    this.responses.set(tool, response);
  }

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ tool, args });
    const resp = this.responses.get(tool);
    if (resp === undefined) return { ok: true, data: [] };
    return resp;
  }
}

describe('FrameworkAdapter', () => {
  let client: MockMCPClient;

  beforeEach(() => {
    client = new MockMCPClient();
  });

  describe('LangGraphMemoryAdapter', () => {
    it('creates with framework name', () => {
      const adapter = new LangGraphMemoryAdapter(client, 'test');
      expect(adapter.framework).toBe('langgraph');
    });

    it('putCheckpoint stores state via MCP', async () => {
      client.setResponse('knowledge_bulk_create', {
        ok: true,
        data: { created: [{ id: 'test-id' }] },
      });
      const adapter = new LangGraphMemoryAdapter(client, 'test');
      await adapter.putCheckpoint('thread-1', { step: 5 });
      const createCall = client.calls.find((c) => c.tool === 'knowledge_bulk_create');
      expect(createCall).toBeDefined();
      expect(createCall!.args.project).toBe('test');
    });

    it('getCheckpoint retrieves state via MCP', async () => {
      client.setResponse('search_knowledge', {
        ok: true,
        data: [{ id: '1', title: 'checkpoint:thread-1', content: '{"step":5}', score: 1.0 }],
      });
      const adapter = new LangGraphMemoryAdapter(client, 'test');
      const state = await adapter.getCheckpoint('thread-1');
      expect(state).toEqual({ step: 5 });
    });

    it('getCheckpoint returns null when no results', async () => {
      client.setResponse('search_knowledge', { ok: true, data: [] });
      const adapter = new LangGraphMemoryAdapter(client, 'test');
      const state = await adapter.getCheckpoint('thread-1');
      expect(state).toBeNull();
    });

    it('search delegates to MCP search_knowledge', async () => {
      client.setResponse('search_knowledge', {
        ok: true,
        data: [{ id: '1', title: 'fact', content: 'test content', score: 0.9, tags: ['test'] }],
      });
      const adapter = new LangGraphMemoryAdapter(client, 'test');
      const results = await adapter.search('query', 5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('test content');
    });
  });

  describe('AutoGenMemoryAdapter', () => {
    it('creates with framework name', () => {
      const adapter = new AutoGenMemoryAdapter(client, 'test');
      expect(adapter.framework).toBe('autogen');
    });

    it('updateContext stores messages', async () => {
      client.setResponse('knowledge_bulk_create', {
        ok: true,
        data: { created: [{ id: 'msg-1' }] },
      });
      const adapter = new AutoGenMemoryAdapter(client, 'test');
      await adapter.updateContext([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]);
      const createCalls = client.calls.filter((c) => c.tool === 'knowledge_bulk_create');
      expect(createCalls).toHaveLength(2);
    });

    it('retrieveContext returns searched + buffered items', async () => {
      client.setResponse('search_knowledge', {
        ok: true,
        data: [{ id: '1', title: 'found', content: 'found content', score: 0.9 }],
      });
      client.setResponse('knowledge_bulk_create', {
        ok: true,
        data: { created: [{ id: 'msg-1' }] },
      });
      const adapter = new AutoGenMemoryAdapter(client, 'test');
      await adapter.updateContext([{ role: 'user', content: 'buffered msg' }]);
      const results = await adapter.retrieveContext('query', 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it('clearContext empties buffer', async () => {
      client.setResponse('knowledge_bulk_create', {
        ok: true,
        data: { created: [{ id: 'msg-1' }] },
      });
      const adapter = new AutoGenMemoryAdapter(client, 'test');
      await adapter.updateContext([{ role: 'user', content: 'msg' }]);
      adapter.clearContext();
      client.setResponse('search_knowledge', { ok: true, data: [] });
      const results = await adapter.retrieveContext('query', 10);
      expect(results).toHaveLength(0);
    });
  });

  describe('CrewAIMemoryAdapter', () => {
    it('creates with framework name', () => {
      const adapter = new CrewAIMemoryAdapter(client, 'test');
      expect(adapter.framework).toBe('crewai');
    });

    it('addMemory stores when no dedup match', async () => {
      client.setResponse('search_knowledge', { ok: true, data: [] });
      client.setResponse('knowledge_bulk_create', {
        ok: true,
        data: { created: [{ id: 'mem-1' }] },
      });
      const adapter = new CrewAIMemoryAdapter(client, 'test');
      const id = await adapter.addMemory('new unique content');
      expect(id).toBe('mem-1');
    });

    it('addMemory returns null when dedup match found', async () => {
      client.setResponse('search_knowledge', {
        ok: true,
        data: [{ id: '1', title: 'existing', content: 'new unique content here with more words', score: 0.9 }],
      });
      const adapter = new CrewAIMemoryAdapter(client, 'test');
      const id = await adapter.addMemory('new unique content here with more words');
      expect(id).toBeNull();
    });

    it('searchEntity delegates to MCP search', async () => {
      client.setResponse('search_knowledge', {
        ok: true,
        data: [{ id: '1', title: 'entity', content: 'Alice works at TechCorp', score: 0.9 }],
      });
      const adapter = new CrewAIMemoryAdapter(client, 'test');
      const results = await adapter.searchEntity('Alice', 5);
      expect(results).toHaveLength(1);
    });

    it('getRecent calls knowledge_list', async () => {
      client.setResponse('knowledge_list', {
        ok: true,
        data: [{ id: '1', title: 'recent', content: 'recent fact', tags: ['crewai'] }],
      });
      const adapter = new CrewAIMemoryAdapter(client, 'test');
      const results = await adapter.getRecent(10);
      expect(results).toHaveLength(1);
      const listCall = client.calls.find((c) => c.tool === 'knowledge_list');
      expect(listCall).toBeDefined();
    });
  });

  describe('LangChainMemoryAdapter', () => {
    it('creates with framework name', () => {
      const adapter = new LangChainMemoryAdapter(client, 'test');
      expect(adapter.framework).toBe('langchain');
    });

    it('saveContext stores human+ai pair', async () => {
      client.setResponse('knowledge_bulk_create', {
        ok: true,
        data: { created: [{ id: 'conv-1' }] },
      });
      const adapter = new LangChainMemoryAdapter(client, 'test');
      await adapter.saveContext('What is 2+2?', '4');
      const createCall = client.calls.find((c) => c.tool === 'knowledge_bulk_create');
      expect(createCall).toBeDefined();
      const items = (createCall!.args.items as Array<{ content: string }>);
      expect(items[0].content).toContain('What is 2+2?');
      expect(items[0].content).toContain('4');
    });

    it('loadMemoryVariables returns history string', async () => {
      client.setResponse('search_knowledge', {
        ok: true,
        data: [
          { id: '1', title: 'ctx', content: 'Previous fact A', score: 0.9 },
          { id: '2', title: 'ctx', content: 'Previous fact B', score: 0.8 },
        ],
      });
      const adapter = new LangChainMemoryAdapter(client, 'test');
      const result = await adapter.loadMemoryVariables('query', 5);
      expect(result.history).toContain('Previous fact A');
      expect(result.history).toContain('Previous fact B');
    });

    it('clear empties buffer', () => {
      const adapter = new LangChainMemoryAdapter(client, 'test');
      adapter.clear();
      expect(adapter).toBeDefined();
    });
  });

  describe('createAdapter factory', () => {
    it('creates langgraph adapter', () => {
      const a = createAdapter('langgraph', client, 'test');
      expect(a).toBeInstanceOf(LangGraphMemoryAdapter);
    });

    it('creates autogen adapter', () => {
      const a = createAdapter('autogen', client, 'test');
      expect(a).toBeInstanceOf(AutoGenMemoryAdapter);
    });

    it('creates crewai adapter', () => {
      const a = createAdapter('crewai', client, 'test');
      expect(a).toBeInstanceOf(CrewAIMemoryAdapter);
    });

    it('creates langchain adapter', () => {
      const a = createAdapter('langchain', client, 'test');
      expect(a).toBeInstanceOf(LangChainMemoryAdapter);
    });
  });
});
