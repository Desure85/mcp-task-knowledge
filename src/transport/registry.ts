/**
 * Transport Registry
 *
 * Central registry that maps transport type names → factories.
 * Built-in transports (stdio, http) are registered by default.
 * Custom transports can be added via `registerTransport()`.
 */

import type { TransportConfig, TransportAdapter, TransportFactory } from './types.js';
import { StdioTransportFactory } from './stdio-transport.js';
import { HttpTransportFactory } from './http-transport.js';

export class TransportRegistry {
  private readonly factories = new Map<string, TransportFactory>();

  constructor() {
    // Register built-in transports
    this.registerTransport(new StdioTransportFactory());
    this.registerTransport(new HttpTransportFactory());
  }

  /**
   * Register a transport factory.
   * @throws if a factory with the same type is already registered.
   */
  registerTransport(factory: TransportFactory): void {
    if (this.factories.has(factory.type)) {
      throw new Error(`[transport] duplicate factory for type "${factory.type}"`);
    }
    this.factories.set(factory.type, factory);
  }

  /**
   * Create a transport adapter from the given config.
   * @throws if no factory is registered for `config.type`.
   */
  createTransport(config: TransportConfig): TransportAdapter {
    const factory = this.factories.get(config.type);
    if (!factory) {
      const available = Array.from(this.factories.keys()).join(', ');
      throw new Error(
        `[transport] unknown type "${config.type}". Available: ${available}`,
      );
    }
    return factory.create(config);
  }

  /**
   * List all registered transport type names.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Check if a transport type is registered.
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * Get a factory by type (for introspection/testing).
   */
  getFactory(type: string): TransportFactory | undefined {
    return this.factories.get(type);
  }
}

/** Default singleton registry with stdio + http built in. */
export const defaultTransportRegistry = new TransportRegistry();
