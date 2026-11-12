/**
 * AC-04c — a read-only tail of the server log.
 *
 * pino writes to stderr only, so an agent that wants to see why something failed has no way in
 * (`journalctl` is an operator tool). Two pieces make a tail possible:
 *
 *   - opt-in file sink: `LOG_FILE` adds a rotating JSON file next to stderr (`src/core/logger.ts`);
 *   - this module: locate the file, read only its tail, filter by level, cap the payload and mask
 *     secrets. Nothing here writes to the log — the tool is read-only by contract.
 *
 * The sink is opt-in on purpose: writing tool arguments to disk by default is a privacy decision,
 * not a debugging convenience (the audit log already exists separately and has its own redaction).
 */

import fs from 'node:fs';
import path from 'node:path';

/** Rotation defaults: 10 MB per file, keep the current one plus two previous. */
export const LOG_ROTATE_BYTES = 10 * 1024 * 1024;
export const LOG_ROTATE_KEEP = 3;

/** How much of the file tail a single read touches. */
const READ_WINDOW_BYTES = 256 * 1024;

export type LogLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';

export interface LogTailOptions {
  /** Absolute path to the JSON log file. */
  file: string;
  /** How many lines to return (the newest ones). */
  lines?: number;
  /** Keep only records at or above this level; `all` keeps everything. */
  level?: LogLevelFilter;
  /** Hard cap for the returned text, in bytes. */
  maxBytes?: number;
  /** Keep only JSON records with this `requestId` (nested tools_run/tools_batch failure). */
  requestId?: string;
  /** Keep only JSON records with this `project` field. */
  project?: string;
}

export interface LogTailResult {
  /** Masked lines, oldest first. */
  lines: string[];
  /** Records considered after the level filter (may exceed `lines`). */
  matched: number;
  /** Lines in the scanned window. */
  scanned: number;
  /** True when the payload or the window cut something away. */
  truncated: boolean;
  /** How many lines had at least one secret masked. */
  maskedLines: number;
  /** Log segments read, oldest first (active file plus `.1`, `.2` when present). */
  segments: string[];
}

const LEVEL_ORDER: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

type SecretReplacement = string | ((whole: string, ...groups: string[]) => string);

const SECRET_PATTERNS: Array<[RegExp, SecretReplacement]> = [
  // JSON Web Tokens: three base64url segments.
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
  // Authorization headers and raw bearer tokens.
  [/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [REDACTED_TOKEN]'],
  // HTTP Basic credentials. Anchored to the authorization field on purpose: prose such as
  // "Basic authentication failed" is not a credential and must survive.
  [
    /((?:proxy-)?authorization["']?\s*[:=]\s*["']?Basic\s+)[A-Za-z0-9+/=]{6,}/gi,
    (_whole: string, prefix: string) => `${prefix}[REDACTED_TOKEN]`,
  ],
  // GitHub tokens (classic and fine-grained).
  [/(gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '[REDACTED_GITHUB_TOKEN]'],
  // OpenAI-style keys.
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]'],
  // AWS access key ids.
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  // PEM private keys, one line or a JSON-escaped block; a truncated header masks the rest.
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    '[REDACTED_PRIVATE_KEY]',
  ],
  // Credentials in a connection URL: scheme://user:password@host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]*):([^/\s@]+)@/gi, (_whole, scheme: string, user: string) => `${scheme}${user}:[REDACTED]@`],
  // Secret query parameters: ?token=..., &password=..., password=...&user=...
  [
    /(^|[?&;\s])((?:token|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|auth[_-]?token|signature|sig)=)([^&\s"'<>]+)/gi,
    (_whole: string, lead: string, key: string) => `${lead}${key}[REDACTED]`,
  ],
  // env-style assignments: MCP_LOGIN_PASSWORD=..., MCP_PROXY_TOKEN=...
  [
    /\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|APIKEY|PRIVATE_KEY))\s*=\s*([^\s"'&,;]+)/g,
    (_whole: string, key: string) => `${key}=[REDACTED]`,
  ],
  // Header-style keys with a dash: x-api-key: ..., x-api-key=...
  [
    /(^|[\s,{])((?:x-api-key|x-auth-token|api-key)\s*[:=]\s*)([^\s"'&,;]+)/gi,
    (_whole: string, lead: string, key: string) => `${lead}${key}[REDACTED]`,
  ],
  // JSON fields whose key ends with a secret word — clientSecret, authToken, x-api-key,
  // access_token. A value masked above keeps its specific marker instead of the generic one.
  [
    /("([A-Za-z0-9_-]*(?:password|passwd|secret|token|apikey|api[_-]?key|private[_-]?key))"\s*:\s*")([^"]{1,512})(")/gi,
    (whole: string, prefix: string, _key: string, value: string, suffix: string) =>
      value.includes('[REDACTED') ? whole : `${prefix}[REDACTED]${suffix}`,
  ],
];

/** Mask tokens, JWTs and password-like fields in one log line. */
export function scrubSecrets(line: string): { line: string; masked: boolean } {
  let masked = false;
  let out = line;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    const next = out.replace(pattern, replacement as unknown as string);
    if (next !== out) masked = true;
    out = next;
  }
  return { line: out, masked };
}

/** Parse the level of a JSON log record; `undefined` for non-JSON lines. */
function levelOf(line: string): string | undefined {
  const start = line.indexOf('"level"');
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(line) as { level?: unknown };
    return typeof parsed.level === 'string' ? parsed.level.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function passesLevel(line: string, filter: LogLevelFilter): boolean {
  if (filter === 'all') return true;
  const level = levelOf(line);
  // Non-JSON lines (stack traces, pino-pretty output) are never filtered out: they carry context.
  if (!level) return true;
  const threshold = LEVEL_ORDER[filter] ?? 0;
  return (LEVEL_ORDER[level] ?? threshold) >= threshold;
}

function jsonField(line: string, key: string): unknown {
  try {
    return (JSON.parse(line) as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function passesFilters(line: string, options: Pick<LogTailOptions, 'level' | 'requestId' | 'project'>): boolean {
  if (!passesLevel(line, options.level ?? 'all')) return false;
  if (options.requestId && jsonField(line, 'requestId') !== options.requestId) return false;
  if (options.project && jsonField(line, 'project') !== options.project) return false;
  return true;
}

/** Resolve the configured log file; relative paths are resolved against `DATA_DIR`. */
export function resolveLogFile(dataDir?: string): string | undefined {
  const configured = process.env.LOG_FILE?.trim();
  if (!configured) return undefined;
  return path.isAbsolute(configured) ? configured : path.resolve(dataDir ?? process.cwd(), configured);
}

/**
 * Read the newest `lines` records from `file`, masking secrets and capping the payload.
 * Read-only: the file is opened `r` and never written.
 */
export function readLogTail(options: LogTailOptions): LogTailResult {
  const wanted = Math.max(1, Math.trunc(options.lines ?? 200));
  const maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? 64 * 1024));
  const level = options.level ?? 'all';
  // Rotation names the previous copies `.1` (newest) and `.2` (oldest kept); read oldest first.
  const candidates = [`${options.file}.${LOG_ROTATE_KEEP - 1}`, `${options.file}.1`, options.file];
  const segments: string[] = [];
  const all: string[] = [];
  let windowTruncated = false;

  for (const segment of candidates) {
    let handle: number;
    try {
      handle = fs.openSync(segment, 'r');
    } catch {
      continue;
    }
    segments.push(segment);
    try {
      const size = fs.fstatSync(handle).size;
      const start = Math.max(0, size - READ_WINDOW_BYTES);
      if (start > 0) windowTruncated = true;
      const length = size - start;
      const buffer = Buffer.alloc(length);
      if (length > 0) fs.readSync(handle, buffer, 0, length, start);
      const lines = buffer.toString('utf8').split('\n').filter((line) => line.trim().length > 0);
      // A partial first line is a side effect of reading the tail of a file.
      if (start > 0 && lines.length > 0) lines.shift();
      all.push(...lines);
    } finally {
      fs.closeSync(handle);
    }
  }

  if (segments.length === 0) throw new Error(`cannot read log file: ${options.file}`);

  const matched = all.filter((line) => passesFilters(line, { level, requestId: options.requestId, project: options.project }));
  const selected = matched.slice(-wanted);

  const maskedLines: string[] = [];
  let masked = 0;
  for (const line of selected) {
    const scrubbed = scrubSecrets(line);
    if (scrubbed.masked) masked++;
    maskedLines.push(scrubbed.line);
  }

  // Cap by bytes from the newest end, so the tail is never cut in the middle of nothing useful.
  const kept: string[] = [];
  let bytes = 0;
  let payloadTruncated = false;
  for (let index = maskedLines.length - 1; index >= 0; index--) {
    const size = Buffer.byteLength(maskedLines[index], 'utf8') + 1;
    if (bytes + size > maxBytes && kept.length > 0) {
      payloadTruncated = true;
      break;
    }
    bytes += size;
    kept.unshift(maskedLines[index]);
  }

  return {
    lines: kept,
    matched: matched.length,
    scanned: all.length,
    truncated: windowTruncated || payloadTruncated || matched.length > selected.length,
    maskedLines: masked,
    segments,
  };
}