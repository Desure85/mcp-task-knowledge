/**
 * tests/e2e-full/connectors-all.test.ts — Q-014 slice 21: all connector
 * families register their tools at protocol level only when enabled.
 *
 * Extends slice 14 (webcrawler-only) to every built-in connector: github,
 * jira, slack, gdrive, gmail, notion, onedrive, linear. Each suite spawns a
 * hermetic server with the family's env flag and checks tools/list.
 * Actual remote calls need real credentials — out of hermetic scope.
 */

import { describe, it, expect } from 'vitest';
import { spawnServer } from './harness.js';

// github/jira/slack throw in init() without credentials — pass dummy values:
// init validates presence only, no network call happens at registration time.
const FAMILIES: Array<{ flag: string; tools: string[]; extraEnv?: Record<string, string> }> = [
  { flag: 'GITHUB_CONNECTOR_ENABLED', tools: ['github_repo_info', 'github_issue_list', 'github_issue_get', 'github_pr_list'], extraEnv: { GITHUB_TOKEN: 'q014-dummy' } },
  { flag: 'JIRA_CONNECTOR_ENABLED', tools: ['jira_project_list', 'jira_issue_list', 'jira_issue_get'], extraEnv: { JIRA_TOKEN: 'q014-dummy', JIRA_HOST: 'jira.example.test' } },
  { flag: 'SLACK_CONNECTOR_ENABLED', tools: ['slack_channels', 'slack_post', 'slack_search'], extraEnv: { SLACK_BOT_TOKEN: 'xoxb-q014-dummy' } },
  { flag: 'GDRIVE_CONNECTOR_ENABLED', tools: ['gdrive_list_files', 'gdrive_get_file', 'gdrive_sync_folder'] },
  { flag: 'GMAIL_CONNECTOR_ENABLED', tools: ['gmail_list_messages', 'gmail_get_message', 'gmail_sync_to_kb'] },
  { flag: 'NOTION_CONNECTOR_ENABLED', tools: ['notion_search_pages', 'notion_get_page', 'notion_sync_database'] },
  { flag: 'ONEDRIVE_CONNECTOR_ENABLED', tools: ['onedrive_list_files', 'onedrive_get_file', 'onedrive_sync_folder'] },
  { flag: 'LINEAR_CONNECTOR_ENABLED', tools: ['linear_list_issues', 'linear_get_issue', 'linear_sync_to_kb'] },
];

async function toolNames(srv: { client: { listTools: () => Promise<{ tools: Array<{ name: string }> }> } }) {
  const res = await srv.client.listTools();
  return res.tools.map((t) => t.name);
}

describe('Q-014 slice 21: connector families absent by default', () => {
  it('no connector tools at protocol level without env flags', async () => {
    const srv = await spawnServer('conn-all-off');
    try {
      const names = await toolNames(srv);
      for (const f of FAMILIES) {
        for (const t of f.tools) expect(names).not.toContain(t);
      }
    } finally {
      await srv.close();
    }
  }, 60000);
});

describe('Q-014 slice 21: each family registers when enabled', () => {
  for (const fam of FAMILIES) {
    it(`${fam.flag}=1 exposes ${fam.tools[0]} family`, async () => {
      const srv = await spawnServer(`conn-${fam.flag.toLowerCase().slice(0, 12)}`, { [fam.flag]: '1', ...fam.extraEnv });
      try {
        const names = await toolNames(srv);
        for (const t of fam.tools) expect(names).toContain(t);
      } finally {
        await srv.close();
      }
    }, 120000);
  }
});
