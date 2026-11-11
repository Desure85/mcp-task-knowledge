import { describe, expect, it } from 'vitest';
import { parseSetupSnippet } from './setup-flow';

const MARKDOWN = [
  '# MCP Setup — mcp-task-knowledge',
  '',
  '```json',
  JSON.stringify({
    mcpServers: {
      'mcp-task-knowledge': {
        url: 'http://127.0.0.1:3001/mcp',
        headers: { Authorization: 'Bearer scoped-token' },
      },
    },
  }, null, 2),
  '```',
].join('\n');

describe('parseSetupSnippet', () => {
  it('extracts the config, token and URL from the fenced JSON', () => {
    const parsed = parseSetupSnippet(MARKDOWN);
    expect(parsed.token).toBe('scoped-token');
    expect(parsed.url).toBe('http://127.0.0.1:3001/mcp');
    expect(parsed.serverName).toBe('mcp-task-knowledge');
    expect(JSON.parse(parsed.configText).mcpServers['mcp-task-knowledge'].headers.Authorization).toBe('Bearer scoped-token');
  });

  it('rejects a document without a fenced config', () => {
    expect(() => parseSetupSnippet('# empty')).toThrow(/JSON config/);
  });

  it('rejects a config without a Bearer token', () => {
    const withoutToken = '```json\n' + JSON.stringify({ mcpServers: { x: { url: 'http://x/mcp' } } }) + '\n```';
    expect(() => parseSetupSnippet(withoutToken)).toThrow(/Bearer token/);
  });
});
