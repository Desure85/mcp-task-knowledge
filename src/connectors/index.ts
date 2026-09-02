/**
 * connectors/index.ts — Barrel exports + default registration (INT-004, WIRE-001)
 *
 * Exports all connector factories and provides `defaultConnectorRegistrations`
 * for the app-container to register all built-in connectors.
 */

export { ConnectorRegistry } from './registry.js';
export type { Connector, ConnectorContext, ConnectorHealth, ConnectorRegistration } from './types.js';

// ─── Built-in connectors ────────────────────────────────────────────
export { createGitHubConnector } from './github.js';
export type { GitHubConfig } from './github.js';
export { createJiraConnector } from './jira.js';
export type { JiraConfig } from './jira.js';
export { createSlackConnector } from './slack.js';
export type { SlackConfig } from './slack.js';

export { createGDriveConnector } from './gdrive.js';
export { createGmailConnector } from './gmail.js';
export { createNotionConnector } from './notion.js';
export { createOneDriveConnector } from './onedrive.js';
export { createLinearConnector } from './linear.js';
export { createWebCrawlerConnector } from './web-crawler.js';

// ─── REST/gRPC wrappers ─────────────────────────────────────────────
export { generateOpenApiSpec, handleRestRequest } from './rest-wrappers.js';
export type { OpenApiSpec, OpenApiOperation, RestHandlerResult } from './rest-wrappers.js';
export { generateProtoSpec, renderProto } from './grpc-wrappers.js';
export type { ProtoService } from './grpc-wrappers.js';

// ─── Default connector registrations ────────────────────────────────
import type { ConnectorRegistration } from './types.js';
import { createGitHubConnector } from './github.js';
import { createJiraConnector } from './jira.js';
import { createSlackConnector } from './slack.js';
import { createGDriveConnector } from './gdrive.js';
import { createGmailConnector } from './gmail.js';
import { createNotionConnector } from './notion.js';
import { createOneDriveConnector } from './onedrive.js';
import { createLinearConnector } from './linear.js';
import { createWebCrawlerConnector } from './web-crawler.js';

/**
 * All built-in connector registrations.
 * Each connector is disabled by default — set `enabled: true` in config
 * or set the appropriate env var to activate.
 */
export const defaultConnectorRegistrations: ConnectorRegistration[] = [
  {
    id: 'github',
    factory: createGitHubConnector,
    defaultConfig: { enabled: process.env.GITHUB_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'jira',
    factory: createJiraConnector,
    defaultConfig: { enabled: process.env.JIRA_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'slack',
    factory: createSlackConnector,
    defaultConfig: { enabled: process.env.SLACK_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  // WIRE-001
  {
    id: 'gdrive',
    factory: createGDriveConnector,
    defaultConfig: { enabled: process.env.GDRIVE_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'gmail',
    factory: createGmailConnector,
    defaultConfig: { enabled: process.env.GMAIL_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'notion',
    factory: createNotionConnector,
    defaultConfig: { enabled: process.env.NOTION_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'onedrive',
    factory: createOneDriveConnector,
    defaultConfig: { enabled: process.env.ONEDRIVE_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'linear',
    factory: createLinearConnector,
    defaultConfig: { enabled: process.env.LINEAR_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
  {
    id: 'web-crawler',
    factory: createWebCrawlerConnector,
    defaultConfig: { enabled: process.env.WEBCRAWLER_CONNECTOR_ENABLED === '1' },
    enabledByDefault: false,
  },
];
