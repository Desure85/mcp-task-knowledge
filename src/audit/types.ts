/**
 * audit/types.ts — Audit logging types (SEC-001).
 *
 * Structured audit trail for all MCP operations.
 * Format: JSON lines, rotation by size/time.
 * Storage: file + optional remote (Syslog/Loki — future).
 */

// ─── Audit Event ──────────────────────────────────────────────────

export type AuditEventType =
  | 'tool.call'
  | 'tool.result'
  | 'tool.error'
  | 'resource.read'
  | 'prompt.get'
  | 'session.open'
  | 'session.close'
  | 'auth.login'
  | 'auth.failure'
  | 'config.change';

export type AuditStatus = 'success' | 'error' | 'denied' | 'pending';

export interface AuditEvent {
  /** Unique event ID (UUID). */
  id: string;
  /** Event type. */
  type: AuditEventType;
  /** Timestamp (ISO 8601). */
  timestamp: string;
  /** Status of the operation. */
  status: AuditStatus;
  /** Session ID (if available). */
  sessionId?: string;
  /** User/client ID (if authenticated). */
  userId?: string;
  /** Client IP address (if available). */
  clientIp?: string;
  /** Tool/resource/prompt name. */
  target: string;
  /** Input arguments (redacted). */
  input?: Record<string, unknown>;
  /** Result (redacted, truncated). */
  result?: unknown;
  /** Error message (if status=error). */
  error?: string;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
  /** Sequence number for stable sorting when timestamps are equal. */
  seq?: number;
}

// ─── Audit Config ─────────────────────────────────────────────────

export interface AuditConfig {
  /** Enable audit logging. */
  enabled: boolean;
  /** File path for audit log (JSON lines). */
  filePath: string;
  /** Max file size before rotation (bytes). 0 = no rotation. */
  maxFileSize: number;
  /** Max number of rotated files to keep. */
  maxFiles: number;
  /** Rotation interval in ms (0 = size-only). */
  rotateIntervalMs: number;
  /** Whether to include input arguments in audit events. */
  logInput: boolean;
  /** Whether to include results in audit events. */
  logResult: boolean;
  /** Max length of stringified result before truncation. */
  maxResultLength: number;
  /** Fields to redact from input/result (e.g., passwords, tokens). */
  redactFields: string[];
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  enabled: false,
  filePath: './audit.log',
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFiles: 5,
  rotateIntervalMs: 0,
  logInput: true,
  logResult: false,
  maxResultLength: 1000,
  redactFields: ['password', 'token', 'secret', 'apiKey', 'jwt', 'authorization'],
};

// ─── Query ────────────────────────────────────────────────────────

export interface AuditQuery {
  /** Filter by event type. */
  type?: AuditEventType;
  /** Filter by status. */
  status?: AuditStatus;
  /** Filter by target (tool/resource name). */
  target?: string;
  /** Filter by session ID. */
  sessionId?: string;
  /** Filter by user ID. */
  userId?: string;
  /** Start time (ISO 8601). */
  since?: string;
  /** End time (ISO 8601). */
  until?: string;
  /** Max results to return. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}
