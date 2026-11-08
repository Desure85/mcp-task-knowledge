/**
 * AC-04c — opt-in rotating file sink for the server log.
 *
 * `logs_tail` (see `src/register/logs.ts`) needs a file to read, but making the server write its
 * log to disk by default is a privacy decision (tool arguments end up there), so the sink is opt-in
 * via `LOG_FILE`. Rotation keeps the active file under a size limit and drops the oldest copy, so a
 * long-running server cannot fill the disk.
 *
 * Writes are synchronous appends on purpose: the sink has no open handle between lines, which is
 * what makes rotation reliable on Windows (a file with an open write stream cannot be renamed).
 * A log line is a handful of microseconds — readability and correctness beat batching here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOG_ROTATE_BYTES, LOG_ROTATE_KEEP } from './log-file.js';

export interface RotatingStream {
  write(chunk: string): void;
  end(): void;
}

/** Create a stream that appends to `file` and rotates past `maxBytes`, keeping `keep` files total. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createRotatingStream(
  file: string,
  maxBytes = envInt('LOG_ROTATE_BYTES', LOG_ROTATE_BYTES),
  keep = envInt('LOG_ROTATE_KEEP', LOG_ROTATE_KEEP),
): RotatingStream {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const rotate = () => {
    // Drop the oldest copy, shift the rest, then move the active file to `.1`.
    for (let index = keep - 1; index >= 1; index--) {
      const from = index === 1 ? file : `${file}.${index - 1}`;
      const to = `${file}.${index}`;
      if (!fs.existsSync(from)) continue;
      try {
        if (fs.existsSync(to)) fs.unlinkSync(to);
        fs.renameSync(from, to);
      } catch {
        // A locked file only means the next rotation retries; losing a line beats failing a request.
      }
    }
    // The active file must always exist, even right after a rotation: `logs_tail` resolves it.
    try {
      if (!fs.existsSync(file)) fs.writeFileSync(file, '', { flag: 'a' });
    } catch {
      // If even the touch fails, the next append recreates the file.
    }
  };

  return {
    write(chunk: string) {
      try {
        fs.appendFileSync(file, chunk, 'utf8');
        if (fs.statSync(file).size >= maxBytes) rotate();
      } catch {
        // Logging must never break the request that is being logged.
      }
    },
    end() {
      // Nothing buffered: every write is already on disk.
    },
  };
}
