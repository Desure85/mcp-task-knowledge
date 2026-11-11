import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CONNECTOR_TIMEOUT_MS,
  connectorSignal,
  connectorTimeoutFromEnv,
} from '../src/connectors/fetch-timeout.js';

const ROOT = path.resolve(process.cwd(), 'src/connectors');
const CONNECTORS = ['github.ts', 'jira.ts', 'slack.ts', 'gdrive.ts', 'gmail.ts', 'notion.ts', 'onedrive.ts', 'linear.ts'];

describe('TR-33 connector fetch timeouts', () => {
  it('defaults to 10 seconds and accepts a positive env override', () => {
    expect(DEFAULT_CONNECTOR_TIMEOUT_MS).toBe(10_000);
    expect(connectorTimeoutFromEnv({ CONNECTOR_TIMEOUT_MS: '2500' } as NodeJS.ProcessEnv)).toBe(2500);
    expect(connectorTimeoutFromEnv({ CONNECTOR_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv)).toBe(10_000);
    expect(connectorTimeoutFromEnv({ CONNECTOR_TIMEOUT_MS: 'wat' } as NodeJS.ProcessEnv)).toBe(10_000);
    expect(connectorSignal(25)).toBeInstanceOf(AbortSignal);
  });

  it('every connector passes the shared signal to fetch', () => {
    const missing = CONNECTORS.filter((file) => {
      const source = readFileSync(path.join(ROOT, file), 'utf8');
      return !source.includes('connectorSignal(');
    });
    expect(missing).toEqual([]);
  });
});
