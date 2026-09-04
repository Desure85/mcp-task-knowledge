/**
 * tests/e2e-full/connectors-registry.test.ts — Q-014 slice 14: connectors e2e.
 *
 * Connector tools register dynamically at server init when enabled via env.
 * Proven end to end: with WEBCRAWLER_CONNECTOR_ENABLED=1 the webcrawler_*
 * tools appear in protocol-level tools/list; without the flag they are
 * absent. Known gap (recorded in BACKLOG Q-014): connector registration
 * bypasses ToolRegistry, so registry tools_list stays blind to them.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

async function protocolToolNames(srv: { client: { listTools: () => Promise<{ tools: Array<{ name: string }> }> } }) {
  const res = await srv.client.listTools();
  return res.tools.map((t) => t.name);
}

describe('Q-014 slice 14: connector registry wiring', () => {
  it('webcrawler tools appear at protocol level only when enabled', async () => {
    const off = await spawnServer('conn-off');
    try {
      expect(await protocolToolNames(off)).not.toContain('webcrawler_fetch_page');
    } finally {
      await off.close();
    }

    const on = await spawnServer('conn-on', { WEBCRAWLER_CONNECTOR_ENABLED: '1' });
    try {
      const names = await protocolToolNames(on);
      expect(names).toContain('webcrawler_fetch_page');
      expect(names).toContain('webcrawler_crawl_site');

      const regList = await on.callTool('tools_list', { search: 'webcrawler' });
      expect(regList.env.ok).toBe(true);
      expect(JSON.stringify(regList.env.data)).not.toContain('webcrawler_fetch_page');
    } finally {
      await on.close();
    }
  }, 120000);
});
