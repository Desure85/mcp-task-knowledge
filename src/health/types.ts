/**
 * health/types.ts — Health check types (SCALE-001).
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  /** Component name (e.g., 'transport', 'session-manager', 'embeddings'). */
  name: string;
  /** Health status. */
  status: HealthStatus;
  /** Whether the component is ready to serve requests. */
  ready: boolean;
  /** Human-readable message. */
  message?: string;
  /** Component-specific details. */
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  /** Overall status — worst of all components. */
  status: HealthStatus;
  /** Whether the server is ready to serve requests. */
  ready: boolean;
  /** Whether the server is draining (not accepting new sessions). */
  draining: boolean;
  /** Server uptime in milliseconds. */
  uptimeMs: number;
  /** Timestamp of the health check (ISO 8601). */
  timestamp: string;
  /** Individual component healths. */
  components: ComponentHealth[];
}

export type HealthCheckFn = () => Promise<ComponentHealth> | ComponentHealth;
