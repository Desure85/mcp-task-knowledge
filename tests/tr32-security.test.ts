import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger.js';
import { createJiraConnector } from '../src/connectors/jira.js';

describe('TR-32 logger redaction', () => {
  it('redacts token/apiKey/authorization at top level and nested objects', () => {
    const chunks: string[] = [];
    const logger = createLogger({ write: (line: string) => chunks.push(line) } as never);
    logger.info(
      {
        token: 'top-secret-token',
        apiKey: 'top-secret-key',
        authorization: 'Bearer top-secret-auth',
        nested: { token: 'nested-secret', apiKey: 'nested-key' },
        safe: 'visible',
      },
      'TR-32 test',
    );
    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('visible');
    expect(output).not.toContain('top-secret');
    expect(output).not.toContain('nested-secret');
    expect(output).not.toContain('nested-key');
  });
});

function jiraCtx(): Parameters<ReturnType<typeof createJiraConnector>['init']>[0] {
  return {
    config: { token: 't' },
    registerTool: () => {},
  } as never;
}

describe('TR-32 JIRA_HOST https enforcement', () => {
  it('rejects plaintext http hosts (Basic auth would leak)', async () => {
    const connector = createJiraConnector({ host: 'http://jira.example', email: 'a@b.c' });
    await expect(connector.init(jiraCtx())).rejects.toThrow(/https/);
  });

  it('rejects non-absolute hosts', async () => {
    const connector = createJiraConnector({ host: 'jira.example' });
    await expect(connector.init(jiraCtx())).rejects.toThrow(/absolute https/);
  });

  it('accepts an https host', async () => {
    const connector = createJiraConnector({ host: 'https://jira.example', email: 'a@b.c' });
    await expect(connector.init(jiraCtx())).resolves.toBeUndefined();
  });
});
