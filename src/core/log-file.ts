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
}

const LEVEL_ORDER: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

type SecretReplacement = string | ((whole: string, ...groups: string[]) => string);

const SECRET_PATTERNS: Array<[RegExp, SecretReplacement]> = [
  // JSON Web Tokens: three base64url segments.
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED_JWT]'],
  // Authorization headers and raw bearer tokens.
  [/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [REDACTED_TOKEN]'],
  // GitHub tokens (classic and fine-grained).
  [/(gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '[REDACTED_GITHUB_TOKEN]'],
  // OpenAI-style keys.
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_API_KEY]'],
  // Anything that looks like a password/token/secret field in JSON. A value that was already
  // masked above keeps its specific marker instead of being replaced by the generic one.
  [
    /("(?:password|passwd|secret|token|apiKey|api_key|access_token|refresh_token)"\s*:\s*")([^"]{1,256})(")/gi,
    (whole: string, prefix: string, value: string, suffix: string) =>
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

  let handle: number;
  try {
    handle = fs.openSync(options.file, 'r');
  } catch (error) {
    throw new Error(`cannot read log file: ${(error as Error).message}`);
  }
  let text = '';
  let windowTruncated = false;
  try {
    const size = fs.fstatSync(handle).size;
    const start = Math.max(0, size - READ_WINDOW_BYTES);
    windowTruncated = start > 0;
    const length = size - start;
    const buffer = Buffer.alloc(length);
    if (length > 0) fs.readSync(handle, buffer, 0, length, start);
    text = buffer.toString('utf8');
  } finally {
    fs.closeSync(handle);
  }

  const all = text.split('\n').filter((line) => line.trim().length > 0);
  // A partial first line is a side effect of reading the tail of a file.
  if (windowTruncated && all.length > 0) all.shift();

  const matched = all.filter((line) => passesLevel(line, level));
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
  };
}
