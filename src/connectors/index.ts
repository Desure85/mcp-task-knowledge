/**
 * connectors/index.ts — Barrel exports (INT-004)
 */

export { ConnectorRegistry } from './registry.js';
export type { Connector, ConnectorContext, ConnectorHealth, ConnectorRegistration } from './types.js';

export { createGitHubConnector } from './github.js';
export type { GitHubConfig } from './github.js';
export { createJiraConnector } from './jira.js';
export type { JiraConfig } from './jira.js';
export { createSlackConnector } from './slack.js';
export type { SlackConfig } from './slack.js';
