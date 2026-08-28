/**
 * audit/index.ts — Public API for audit module (SEC-001).
 */

export { AuditLogger } from './logger.js';
export { AuditMiddleware } from './middleware.js';
export { DEFAULT_AUDIT_CONFIG } from './types.js';
export type {
  AuditEvent,
  AuditEventType,
  AuditStatus,
  AuditConfig,
  AuditQuery,
  AuditQueryResult,
} from './types.js';
