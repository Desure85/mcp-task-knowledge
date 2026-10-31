import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type E2EServer } from './e2e-full/harness.js';

let srv: E2EServer;

describe('prompts_get', () => {
  beforeAll(async () => {
    srv = await spawnServer('prompts-get');
  });

  afterAll(async () => {
    await srv?.close();
  });

  it('returns the latest version by default and lists all source versions', async () => {
    const id = `get-prompt-${Date.now()}`;
    const base = {
      type: 'prompt',
      id,
      metadata: { title: id, domain: 'q-test', status: 'draft', kind: 'prompt', tags: ['q'] },
      variables: [],
    };
    const created = await srv.callTool('prompts_bulk_create', {
      project: 'mcp',
      items: [
        { ...base, version: '1.0.0', template: 'old {{x}}' },
        { ...base, version: '1.1.0', template: 'new {{x}}' },
      ],
    });
    expect(created.env.ok).toBe(true);

    try {
      const latest = await srv.callTool('prompts_get', { project: 'mcp', id });
      expect(latest.env.ok).toBe(true);
      expect(latest.env.data.prompt.version).toBe('1.1.0');
      expect(latest.env.data.prompt.template).toBe('new {{x}}');
      expect(latest.env.data.versions.map((v: any) => v.version)).toEqual(['1.0.0', '1.1.0']);
      expect(latest.env.data.versions[1].latest).toBe(true);

      const old = await srv.callTool('prompts_get', { project: 'mcp', id, version: '1.0.0' });
      expect(old.env.ok).toBe(true);
      expect(old.env.data.prompt.template).toBe('old {{x}}');

      const missing = await srv.callTool('prompts_get', { project: 'mcp', id, version: '9.9.9' });
      expect(missing.isError).toBe(true);
      expect(missing.env.ok).toBe(false);
    } finally {
      await srv.callTool('prompts_bulk_delete', {
        project: 'mcp',
        items: [{ id, version: '1.0.0' }, { id, version: '1.1.0' }],
      });
    }
  }, 120_000);
});
