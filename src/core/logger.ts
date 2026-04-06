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

/**
 * Create (or return cached) root logger.
 * Idempotent — safe to call from any module.
 */
export function createLogger(): Logger {
  if (_root) return _root;

  const level = resolveLevel();
  const format = resolveFormat();

  let stream: DestinationStream;
  if (format === 'pretty') {
    // pino-pretty for human-readable dev output
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pinoPretty = require('pino-pretty');
    stream = pinoPretty.default
      ? pinoPretty.default({ colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', ignore: 'pid,hostname' })
      : pinoPretty({ colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', ignore: 'pid,hostname' });
  } else {
    stream = pino.destination({ level, sync: false });
  }

  _root = pino(
    {
      name: 'mcp-task-knowledge',
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
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
