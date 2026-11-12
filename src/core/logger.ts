/**
 * Structured logging module (F-004)
 *
 * Uses Pino for fast, structured JSON logging to stderr.
 * - MCP servers MUST log to stderr (stdout is reserved for the protocol).
 * - Child loggers carry a `module` field for easy filtering.
 * - LOG_LEVEL env var controls verbosity (default: "warn" for stdio, "info" for http).
 * - LOG_FORMAT=json|pretty controls output (pretty is for dev only, never in production).
 */

import pino, { type Logger, type DestinationStream } from 'pino';
import { resolveLogFile } from './log-file.js';
import { createRotatingStream } from './log-rotation.js';

// ---------- environment ----------

function resolveLevel(): pino.Level {
  const env = (process.env.LOG_LEVEL || '').toLowerCase();
  if (env && ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'].includes(env)) {
    return env as pino.Level;
  }
  // Default: warn in stdio mode (minimal noise), info in http mode
  const transport = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  return transport === 'stdio' ? 'warn' : 'info';
}

function resolveFormat(): 'json' | 'pretty' {
  const env = (process.env.LOG_FORMAT || '').toLowerCase();
  if (env === 'pretty') return 'pretty';
  if (env === 'json') return 'json';
  // Default: json (structured, safe for production)
  return 'json';
}

// ---------- logger factory ----------

let _root: Logger | undefined;

// TR-32: defense-in-depth before LoggingMiddleware. Pino wildcard paths cover
// top-level and nested secret fields without leaking their values.
export const LOG_REDACT_PATHS = [
  'token', 'apiKey', 'authorization', 'password', 'secret',
  '*.token', '*.apiKey', '*.authorization', '*.password', '*.secret',
  'req.headers.authorization', 'headers.authorization',
] as const;

/**
 * Create (or return cached) root logger.
 * Idempotent — safe to call from any module.
 */
export function createLogger(destination?: DestinationStream): Logger {
  if (destination) {
    return pino(
      {
        name: 'mcp-task-knowledge',
        level: 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: { paths: [...LOG_REDACT_PATHS], censor: '[REDACTED]' },
      },
      destination,
    );
  }
  if (_root) return _root;

  const level = resolveLevel();
  const format = resolveFormat();

  let stream: DestinationStream;
  if (format === 'pretty') {
    // pino-pretty for human-readable dev output
     
    const pinoPretty = require('pino-pretty');
    stream = pinoPretty.default
      ? pinoPretty.default({ colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', ignore: 'pid,hostname', destination: 2 })
      : pinoPretty({ colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', ignore: 'pid,hostname', destination: 2 });
  } else {
    stream = pino.destination({ dest: 2, level, sync: false });
  }

  // AC-04c: opt-in file sink. It sits next to stderr (not instead of it) and receives the raw
  // JSON form even in pretty mode, so `logs_tail` can parse records.
  const logFile = resolveLogFile(process.env.DATA_DIR);
  if (logFile) {
    stream = pino.multistream([{ stream }, { stream: createRotatingStream(logFile) }]);
  }

  _root = pino(
    {
      name: 'mcp-task-knowledge',
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: [...LOG_REDACT_PATHS], censor: '[REDACTED]' },
      // Base bindings available to all log lines
      base: {
        pid: process.pid,
      },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      // Suppress pino's own startup banner in stdio mode
      ...(format === 'json' ? { hooks: { logMethod(inputArgs: [obj: unknown, msg?: string, ...args: unknown[]], method: pino.LogFn) {
        // Flatten error objects for cleaner JSON
        const args = inputArgs.map((a) => {
          if (a instanceof Error) {
            return { err: { name: a.name, message: a.message, stack: a.stack } };
          }
          return a;
        });
        method.apply(this, inputArgs as [obj: unknown, msg?: string, ...args: unknown[]]);
      }}} : {}),
    },
    stream,
  );

  return _root;
}

/** SPEC-08: map MCP logging levels to pino's smaller level set. */
export function mapMcpLogLevel(level: string): pino.Level {
  switch (level) {
    case 'debug': return 'debug';
    case 'info':
    case 'notice': return 'info';
    case 'warning': return 'warn';
    case 'error': return 'error';
    case 'critical':
    case 'alert':
    case 'emergency': return 'fatal';
    default: throw new Error(`unsupported MCP logging level: ${level}`);
  }
}

/** SPEC-08: logging/setLevel handler mutates the root logger level. */
export function setLogLevel(level: string): pino.Level {
  const mapped = mapMcpLogLevel(level);
  const logger = getRootLogger();
  if (!logger) throw new Error('logger is not initialized');
  logger.level = mapped;
  return mapped;
}

/**
 * Get the root logger without creating one.
 * Returns undefined if createLogger() was not yet called.
 */
export function getRootLogger(): Logger | undefined {
  return _root;
}

/**
 * Create a child logger with a `module` field.
 * Example: logger.child('config') → all lines have { module: 'config', ... }
 */
export function childLogger(module: string, extra?: Record<string, unknown>): Logger {
  const root = createLogger();
  return root.child({ module, ...extra });
}

/**
 * Utility: replace all console.* calls in a file with logger calls.
 * Returns the child logger for the given module name.
 *
 * Usage in other modules:
 *   import { childLogger } from '../core/logger.js';
 *   const log = childLogger('tasks');
 *   log.info('task created', { id: '123' });
 */
export default createLogger;
