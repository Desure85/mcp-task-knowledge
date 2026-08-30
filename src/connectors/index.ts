/**
 * connectors/index.ts — Barrel exports (INT-004)
 */

export { ConnectorRegistry } from './registry.js';
export type { Connector, ConnectorContext, ConnectorHealth, ConnectorRegistration } from './types.js';

export { createGitHubConnector } from './github.js';
export type { GitHubConfig } from './github.js';
