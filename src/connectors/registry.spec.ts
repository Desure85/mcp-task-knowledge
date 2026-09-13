/**
 * connectors/registry.spec.ts — Tests for connector framework (INT-004)
 */

import { describe, it, expect, vi } from 'vitest';
import { ConnectorRegistry } from './registry.js';
import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

function makeConnector(id: string, health: ConnectorHealth = { healthy: true }): Connector {
  return {
    id,
    name: id,
    version: '1.0.0',
    async init(_ctx: ConnectorContext) {},
    async health() { return health; },
  };
}

describe('INT-004: ConnectorRegistry', () => {
  it('registers and lists connectors', () => {
    const reg = new ConnectorRegistry();
    reg.register({ id: 'github', factory: () => makeConnector('github') });
    reg.register({ id: 'jira', factory: () => makeConnector('jira') });
    expect(reg.has('github')).toBe(true);
    expect(reg.list()).toEqual(['github', 'jira']);
    expect(reg.registeredCount).toBe(2);
  });

  it('initAll initializes enabled connectors only', async () => {
    const reg = new ConnectorRegistry();
    const initSpy = vi.fn();
    reg.register({ id: 'github', factory: (cfg) => ({ ...makeConnector('github'), init: async () => initSpy(cfg) }) });
    reg.register({ id: 'jira', factory: () => makeConnector('jira'), enabledByDefault: false });

    const result = await reg.initAll(
      { github: { enabled: true }, jira: { enabled: false } },
      () => {},
    );
    expect(result.initialized).toEqual(['github']);
    expect(result.skipped).toEqual(['jira']);
    expect(initSpy).toHaveBeenCalledWith({ enabled: true });
  });

  it('enabledByDefault activates without explicit config', async () => {
    const reg = new ConnectorRegistry();
    reg.register({ id: 'slack', factory: () => makeConnector('slack'), enabledByDefault: true });
    const result = await reg.initAll({}, () => {});
    expect(result.initialized).toEqual(['slack']);
  });

  it('init errors are captured, not thrown', async () => {
    const reg = new ConnectorRegistry();
    reg.register({
      id: 'broken',
      factory: () => ({
        ...makeConnector('broken'),
        init: async () => { throw new Error('init boom'); },
      }),
    });
    const result = await reg.initAll({ broken: { enabled: true } }, () => {});
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('broken');
    expect(result.errors[0].error).toBe('init boom');
  });

  it('healthAll aggregates health from active connectors', async () => {
    const reg = new ConnectorRegistry();
    reg.register({ id: 'ok', factory: () => makeConnector('ok', { healthy: true }) });
    reg.register({ id: 'down', factory: () => makeConnector('down', { healthy: false, message: 'offline' }) });
    await reg.initAll({ ok: { enabled: true }, down: { enabled: true } }, () => {});
    const health = await reg.healthAll();
    expect(health.ok.healthy).toBe(true);
    expect(health.down.healthy).toBe(false);
    expect(health.down.message).toBe('offline');
  });

  it('destroyAll cleans up and resets active count', async () => {
    const reg = new ConnectorRegistry();
    const destroySpy = vi.fn();
    reg.register({
      id: 'cleanup',
      factory: () => ({
        ...makeConnector('cleanup'),
        destroy: async () => destroySpy(),
      }),
    });
    await reg.initAll({ cleanup: { enabled: true } }, () => {});
    expect(reg.activeCount).toBe(1);
    await reg.destroyAll();
    expect(reg.activeCount).toBe(0);
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  // TR-27: file config merge semantics
  it('file config entry activates connector without explicit enabled flag', async () => {
    const reg = new ConnectorRegistry();
    const initSpy = vi.fn();
    reg.register({
      id: 'github',
      factory: (cfg) => ({ ...makeConnector('github'), init: async () => initSpy(cfg) }),
      enabledByDefault: false,
    });
    const result = await reg.initAll({ github: { token: 'ghp_x' } }, () => {});
    expect(result.initialized).toEqual(['github']);
    expect(initSpy).toHaveBeenCalledWith(expect.objectContaining({ token: 'ghp_x', enabled: true }));
  });

  it('file config entry with enabled:false skips connector', async () => {
    const reg = new ConnectorRegistry();
    reg.register({ id: 'github', factory: () => makeConnector('github'), enabledByDefault: true });
    const result = await reg.initAll({ github: { enabled: false, token: 'x' } }, () => {});
    expect(result.skipped).toEqual(['github']);
    expect(result.initialized).toEqual([]);
  });

  it('file config merges over defaultConfig (file wins, defaults preserved)', async () => {
    const reg = new ConnectorRegistry();
    const initSpy = vi.fn();
    reg.register({
      id: 'jira',
      factory: (cfg) => ({ ...makeConnector('jira'), init: async () => initSpy(cfg) }),
      defaultConfig: { enabled: false, host: 'https://default.atlassian.net', timeout: 5000 },
    });
    await reg.initAll({ jira: { token: 'tok' } }, () => {});
    expect(initSpy).toHaveBeenCalledWith({
      enabled: true,
      host: 'https://default.atlassian.net',
      timeout: 5000,
      token: 'tok',
    });
  });

  it('connector without file entry still activates via defaultConfig.enabled', async () => {
    const reg = new ConnectorRegistry();
    reg.register({
      id: 'slack',
      factory: () => makeConnector('slack'),
      defaultConfig: { enabled: true },
      enabledByDefault: false,
    });
    const result = await reg.initAll({}, () => {});
    expect(result.initialized).toEqual(['slack']);
  });

  it('file config value overrides defaultConfig.enabled=true', async () => {
    const reg = new ConnectorRegistry();
    reg.register({
      id: 'notion',
      factory: () => makeConnector('notion'),
      defaultConfig: { enabled: true },
    });
    const result = await reg.initAll({ notion: { enabled: false } }, () => {});
    expect(result.skipped).toEqual(['notion']);
  });
});
