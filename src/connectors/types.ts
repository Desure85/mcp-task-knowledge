/**
 * connectors/types.ts — Connector framework types (INT-004)
 *
 * A connector is a plug-in that integrates an external service (GitHub,
 * Jira, Slack, etc.) into mcp-task-knowledge. Each connector registers
 * MCP tools, provides a health check, and manages its own lifecycle.
 */

export interface ConnectorContext {
  /** Connector-specific configuration (from env or config file). */
  config: Record<string, unknown>;
  /** Register an MCP tool. */
  registerTool: (name: string, schema: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }, handler: (input: Record<string, unknown>) => Promise<unknown>) => void;
}

export interface ConnectorHealth {
  healthy: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface Connector {
  /** Unique connector ID (e.g., 'github', 'jira'). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Version (semver). */
  readonly version: string;
  /** Initialize the connector and register tools. */
  init(ctx: ConnectorContext): Promise<void>;
  /** Health check. */
  health(): Promise<ConnectorHealth>;
  /** Graceful shutdown. */
  destroy?(): Promise<void>;
}

export interface ConnectorRegistration {
  id: string;
  factory: (config: Record<string, unknown>) => Connector;
  /** Default config from env vars. */
  defaultConfig?: Record<string, unknown>;
  /** Whether the connector is enabled by default. */
  enabledByDefault?: boolean;
}
