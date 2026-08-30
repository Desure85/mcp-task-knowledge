/**
 * connectors/registry.ts — Connector registry and lifecycle (INT-004)
 *
 * Manages connector registration, initialization, and health aggregation.
 * Connectors are registered with a factory function and activated when
 * their config is present (env vars or config file).
 */

import { childLogger } from '../core/logger.js';
import type { Connector, ConnectorContext, ConnectorHealth, ConnectorRegistration } from './types.js';

const log = childLogger('connectors');

export class ConnectorRegistry {
  private readonly registrations = new Map<string, ConnectorRegistration>();
  private readonly instances = new Map<string, Connector>();

  /** Register a connector factory. */
  register(reg: ConnectorRegistration): void {
    if (this.registrations.has(reg.id)) {
      log.warn({ id: reg.id }, 'connector already registered, replacing');
    }
    this.registrations.set(reg.id, reg);
    log.info({ id: reg.id }, 'connector registered');
  }

  /** Check if a connector is registered. */
  has(id: string): boolean {
    return this.registrations.has(id);
  }

  /** List all registered connector IDs. */
  list(): string[] {
    return [...this.registrations.keys()].sort();
  }

  /**
   * Initialize all enabled connectors.
   * A connector is enabled if its config has `enabled: true` or if
   * `enabledByDefault` is true and config doesn't explicitly disable it.
   */
  async initAll(
    configs: Record<string, Record<string, unknown>>,
    registerTool: ConnectorContext['registerTool'],
  ): Promise<{ initialized: string[]; skipped: string[]; errors: Array<{ id: string; error: string }> }> {
    const initialized: string[] = [];
    const skipped: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const [id, reg] of this.registrations) {
      const config = configs[id] ?? reg.defaultConfig ?? {};
      const enabled = config.enabled ?? reg.enabledByDefault ?? false;

      if (!enabled) {
        skipped.push(id);
        continue;
      }

      try {
        const connector = reg.factory(config);
        const ctx: ConnectorContext = { config, registerTool };
        await connector.init(ctx);
        this.instances.set(id, connector);
        initialized.push(id);
        log.info({ id }, 'connector initialized');
      } catch (e) {
        errors.push({ id, error: (e as Error).message });
        log.error({ id, err: e }, 'connector init failed');
      }
    }

    return { initialized, skipped, errors };
  }

  /** Health check for all active connectors. */
  async healthAll(): Promise<Record<string, ConnectorHealth>> {
    const results: Record<string, ConnectorHealth> = {};
    for (const [id, connector] of this.instances) {
      try {
        results[id] = await connector.health();
      } catch (e) {
        results[id] = { healthy: false, message: (e as Error).message };
      }
    }
    return results;
  }

  /** Destroy all active connectors (graceful shutdown). */
  async destroyAll(): Promise<void> {
    for (const [id, connector] of this.instances) {
      try {
        await connector.destroy?.();
        log.info({ id }, 'connector destroyed');
      } catch (e) {
        log.warn({ id, err: e }, 'connector destroy failed');
      }
    }
    this.instances.clear();
  }

  /** Number of active (initialized) connectors. */
  get activeCount(): number {
    return this.instances.size;
  }

  /** Number of registered connectors. */
  get registeredCount(): number {
    return this.registrations.size;
  }
}
