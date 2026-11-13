import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerContext } from '../src/register/context.js';

type Handler = (input: { project?: string }) => Promise<{ content: Array<{ text: string }> }>;
const tools: Record<string, Handler> = {};
const registered = ['briefing', 'tasks_list', 'tasks_create', 'knowledge_search', 'agent_bootstrap'];
const ctx = {
  server: {
    registerTool: (name: string, _def: unknown, handler: Handler) => { tools[name] = handler; },
  },
  toolRegistry: {
    names: () => [...registered, 'tasks_get'].sort(),
    size: registered.length + 1,
    version: 7,
  },
  SERVER_CAPS: {
    resources: { subscribe: true, listChanged: false },
    tools: { listChanged: true },
    prompts: { listChanged: false },
  },
} as unknown as ServerContext;

const prev = process.env.CURRENT_PROJECT;
beforeAll(async () => {
  process.env.CURRENT_PROJECT = 'mcp';
  const { registerBootstrapTools } = await import('../src/register/bootstrap.js');
  registerBootstrapTools(ctx);
});
afterAll(() => {
  if (prev === undefined) delete process.env.CURRENT_PROJECT; else process.env.CURRENT_PROJECT = prev;
});

describe('DX-12 agent_bootstrap', () => {
  it('returns instructions, capabilities and only registered recommended tools', async () => {
    const raw = await tools['agent_bootstrap']!({});
    const result = JSON.parse(raw.content[0]!.text) as {
      ok: boolean; data: {
        project: string; instructions: { format: string; text: string }; server: { toolCount: number; capabilities: unknown };
        tools: { recommended: string[]; disabled: string[]; total: number };
      };
    };
    expect(result.ok).toBe(true);
    expect(result.data.project).toBe('mcp');
    expect(result.data.instructions.format).toBe('markdown');
    expect(result.data.instructions.text).toContain('{ok:false,error');
    expect(result.data.instructions.text.length).toBeLessThanOrEqual(4096);
    expect(result.data.server.toolCount).toBe(6);
    expect(result.data.server.capabilities).toEqual(ctx.SERVER_CAPS);
    expect(result.data.tools.recommended).toContain('tasks_list');
    expect(result.data.tools.recommended).not.toContain('memory_temporal_query');
    expect(result.data.tools.disabled).toContain('memory_temporal_query');
  });

  it('honours an explicit project and never returns task data', async () => {
    const raw = await tools['agent_bootstrap']!({ project: 'other' });
    const result = JSON.parse(raw.content[0]!.text) as {
      data: { project: string; instructions: { text: string } };
    };
    expect(result.data.project).toBe('other');
    expect(result.data.instructions.text).not.toContain('openTasks');
    expect(result.data.instructions.text).not.toContain('secret');
  });
});
