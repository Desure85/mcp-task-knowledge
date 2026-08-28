/**
 * health/index.ts — Health module exports (SCALE-001).
 */

export type { HealthStatus, ComponentHealth, HealthCheckResult, HealthCheckFn } from './types.js';
export { HealthChecker } from './checker.js';
export { createHealthHandlers, matchHealthEndpoint } from './endpoints.js';
export type { HealthHandlers } from './endpoints.js';
