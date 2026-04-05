/**
 * Transport Layer — barrel export
 *
 * Public API:
 *   - TransportConfig, TransportAdapter, TransportFactory  (types)
 *   - TransportRegistry                                     (registry)
 *   - defaultTransportRegistry                               (singleton)
 *   - StdioTransportAdapter, StdioTransportFactory          (stdio)
 *   - HttpTransportAdapter, HttpTransportFactory            (http)
 */

export type { TransportConfig, TransportAdapter, TransportFactory } from './types.js';
export { TransportRegistry, defaultTransportRegistry } from './registry.js';
export { StdioTransportAdapter, StdioTransportFactory } from './stdio-transport.js';
export { HttpTransportAdapter, HttpTransportFactory } from './http-transport.js';
