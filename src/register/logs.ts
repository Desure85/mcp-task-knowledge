/**
 * AC-04c — `logs_tail`: read-only tail of the server log.
 *
 * The tool reads the file configured by `LOG_FILE` (see `src/core/log-file.ts` and the sink in
 * `src/core/logger.ts`), returns the newest records, filters by level, caps the payload and masks
 * secrets. It never writes: opening the file is `r`, and a test asserts the file is byte-identical
 * after the call.
 *
 * File logging is opt-in, so a missing `LOG_FILE` is a normal answer (with a hint), not an error in
 * the tool's own logic.
 */

import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { ok, errWith } from '../utils/respond.js';
import { readLogTail, resolveLogFile } from '../core/log-file.js';

export function registerLogTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'logs_tail',
    {
      title: 'Tail Server Log',
      description:
        'Read the newest records of the server JSON log (read-only). File logging is opt-in: set LOG_FILE to a path ' +
        '(relative paths resolve against DATA_DIR). Secrets — JWTs, bearer tokens, GitHub/OpenAI keys and ' +
        'password/token JSON fields — are masked before returning. Use the `requestId` from tools_run/tools_batch ' +
        'failures to find the matching line.',
      inputSchema: {
        project: z.string().optional(),
        lines: z.number().int().min(1).max(2000).optional().describe('How many newest lines to return (default 200)'),
        level: z
          .enum(['all', 'error', 'warn', 'info', 'debug'])
          .optional()
          .describe('Keep records at or above this level (default all); non-JSON lines are always kept'),
        maxBytes: z
          .number()
          .int()
          .min(1024)
          .max(512 * 1024)
          .optional()
          .describe('Payload cap in bytes (default 65536)'),
      },
    },
    async ({ project, lines, level, maxBytes }) => {
      // project is accepted for surface symmetry, but the log is server-wide.
      resolveProject(project);
      const file = resolveLogFile(process.env.DATA_DIR);
      if (!file) {
        return errWith({
          code: 'LOG_FILE_DISABLED',
          message: 'File logging is disabled: LOG_FILE is not set',
          hint: 'start the server with LOG_FILE=logs/server.log (relative paths resolve against DATA_DIR)',
        });
      }
      try {
        const tail = readLogTail({ file, lines, level, maxBytes });
        return ok({
          file,
          level: level ?? 'all',
          lines: tail.lines,
          count: tail.lines.length,
          matched: tail.matched,
          scanned: tail.scanned,
          truncated: tail.truncated,
          maskedLines: tail.maskedLines,
        });
      } catch (error) {
        return errWith({
          code: 'LOG_FILE_UNREADABLE',
          message: (error as Error).message,
          hint: 'check that LOG_FILE exists and is readable by the server user',
        });
      }
    },
  );
}
