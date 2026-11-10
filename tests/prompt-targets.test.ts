import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;
const PROJECT = 'prompt-targets';
const IDS = {
  universal: 'MCP-PROMPT-ZTA-001',
  claude: 'MCP-PROMPT-ZTA-002',
  custom: 'MCP-PROMPT-ZTA-003',
};

function prompt(id: string, title: string, target?: string) {
  return {
    type: 'prompt',
    id,
    version: '1.0.0',
    template: `${title} body zta-unique-token`,
    metadata: {
      title,
      domain: 'zta',
      status: 'draft',
      kind: 'prompt',
      ...(target ? { target } : {}),
    },
    variables: [],
  };
}

async function list(target?: string) {
  const args: Record<string, unknown> = { project: PROJECT, limit: 50 };
  if (target) args.target = target;
  const res = await srv.callTool('prompts_list', args);
  expect(res.env.ok).toBe(true);
  return res.env.data.items as Array<{ id: string; target: string }>;
}

async function search(target?: string) {
  const args: Record<string, unknown> = { project: PROJECT, query: 'zta-unique-token', limit: 20 };
  if (target) args.target = target;
  const res = await srv.callTool('prompts_search', args);
  expect(res.env.ok).toBe(true);
  return res.env.data as Array<{ key: string; target: string }>;
}

describe('Z-10: prompt/skill agent targets', () => {
  beforeAll(async () => {
    srv = await spawnServer('prompt-targets');
    const created = await srv.callTool('prompts_bulk_create', {
      project: PROJECT,
      items: [
        prompt(IDS.universal, 'Universal prompt'),
        prompt(IDS.claude, 'Claude prompt', 'claude'),
        prompt(IDS.custom, 'Custom prompt', 'custom'),
      ],
    });
    expect(created.env.ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await srv?.close();
  });

  it('treats a missing target as universal and filters list by target', async () => {
    const universal = await list('universal');
    expect(universal.map((item) => item.id)).toContain(IDS.universal);
    expect(universal.map((item) => item.id)).not.toContain(IDS.claude);
    expect(universal.find((item) => item.id === IDS.universal)?.target).toBe('universal');

    const claude = await list('claude');
    expect(claude.map((item) => item.id)).toEqual(expect.arrayContaining([IDS.universal, IDS.claude]));
    expect(claude.find((item) => item.id === IDS.claude)?.target).toBe('claude');

    const opencode = await list('opencode');
    expect(opencode.map((item) => item.id)).toContain(IDS.universal);
    expect(opencode.map((item) => item.id)).not.toContain(IDS.claude);
  });

  it('applies the same scalar target filter to search', async () => {
    const universal = await search('universal');
    expect(universal.map((item) => item.key)).toContain(IDS.universal);
    expect(universal.map((item) => item.key)).not.toContain(IDS.claude);

    const opencode = await search('opencode');
    expect(opencode.map((item) => item.key)).toContain(IDS.universal);
    expect(opencode.map((item) => item.key)).not.toContain(IDS.claude);
  });

  it('round-trips a custom registry and keeps built-ins', async () => {
    const defaults = await srv.callTool('project_agents_get', { project: PROJECT });
    expect(defaults.env.data.agents.map((agent: { id: string }) => agent.id)).toEqual(
      expect.arrayContaining(['universal', 'claude', 'opencode']),
    );
    expect(defaults.env.data.defaults).toBe(true);

    const set = await srv.callTool('project_agents_set', {
      project: PROJECT,
      agents: ['universal', 'claude', 'opencode', 'custom'],
    });
    expect(set.env.ok).toBe(true);
    expect(set.env.data.agents).toEqual(
      expect.arrayContaining([{ id: 'custom', builtin: false }]),
    );
    expect(set.env.data.defaults).toBe(false);

    const again = await srv.callTool('project_agents_get', { project: PROJECT });
    expect(again.env.data.agents.map((agent: { id: string }) => agent.id)).toContain('custom');
  });

  it('rejects removing a target used by prompts without moveTo, then moves it', async () => {
    const rejected = await srv.callTool('project_agents_set', {
      project: PROJECT,
      agents: ['universal', 'claude', 'opencode'],
    });
    expect(rejected.env.ok).toBe(false);
    expect(rejected.env.error.code).toBe('AGENT_TARGET_IN_USE');

    const moved = await srv.callTool('project_agents_set', {
      project: PROJECT,
      agents: ['universal', 'claude', 'opencode'],
      moveTo: 'claude',
    });
    expect(moved.env.ok).toBe(true);
    expect(moved.env.data.moved).toEqual([{ id: IDS.custom, from: 'custom', to: 'claude' }]);

    const claude = await list('claude');
    expect(claude.find((item) => item.id === IDS.custom)?.target).toBe('claude');
    const opencode = await list('opencode');
    expect(opencode.map((item) => item.id)).not.toContain(IDS.custom);
  });

  it('documents both registry tools in the generated API reference', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs/api-reference.md'), 'utf8');
    expect(doc).toContain('project_agents_get');
    expect(doc).toContain('project_agents_set');
  });
});
