/**
 * AC-01 — tool argument contracts.
 *
 * Two defects confirmed on `master` f6a748f (see `BACKLOG.md` AC-01):
 *
 *   1. an unknown top-level argument was silently dropped — `tasks_list({ tags: ['x'] })`
 *      returned every task instead of failing, because the MCP SDK validates with
 *      `z.object(shape)` and Zod strips unknown keys before the handler ever sees them;
 *   2. an empty string was written through — `tasks_bulk_create` with `parentId: ""`
 *      created a task and persisted an empty `parentId` in the file.
 *
 * The fix for (1) has to happen in one place for every tool: the central `registerTool`
 * wrapper in `src/register/setup.ts`. It passes a **loose** object schema to the SDK, so
 * unknown keys survive validation, and wraps the handler so they are reported instead of
 * ignored. Known keys reach the tool unchanged, so a valid call behaves exactly as before.
 *
 * Flavour note: registrars declare schemas with two different Zod entry points — 25 files
 * import `zod/v3`, 2 import `zod` (v4). Schemas of the two flavours are not compatible for
 * `instanceof` or for wrapping, so the shape is recognised by duck-typing and the loose
 * schema is built with the same flavour the shape came from.
 *
 * The envelope follows the repository convention from `src/utils/respond.ts`
 * (`{ ok: false, error: { code, message, hint, details } }`), which is what AC-01's
 * `{ ok:false, code:'UNKNOWN_PARAM', hint }` shorthand describes.
 */

import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod';
import { errWith } from '../utils/respond.js';
import { blankToUndefined } from '../utils/strings.js';

export { blankToUndefined } from '../utils/strings.js';

type ToolHandler = (args: unknown, extra?: unknown) => unknown;

/** Prefix used in the error message so a failed call names the tool. */
const LABEL_LIMIT = 5;

/** `''`, `'   '` and `null` all mean "the field is absent" for id-like inputs. */

/** A Zod schema of either flavour (v3 and v4 do not share a prototype). */
function isZodSchema(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { safeParse?: unknown; parse?: unknown; _def?: unknown; _zod?: unknown };
  return (
    typeof candidate.safeParse === 'function' ||
    typeof candidate.parse === 'function' ||
    '_def' in candidate ||
    '_zod' in candidate
  );
}

/** Levenshtein distance, small inputs only (tool argument names). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[cols - 1];
}

/**
 * The nearest allowed name, for the hint. `tags` -> `tag` is the case AC-01 names, so the
 * threshold is deliberately generous for short names and tight for long ones.
 */
export function closestName(target: string, allowed: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const distance = editDistance(target.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (!best) return undefined;
  const limit = Math.max(1, Math.floor(target.length / 2));
  return bestDistance <= limit ? best : undefined;
}

/**
 * Recognise the `inputSchema` a registrar passes to `registerTool`: a plain object of Zod
 * types (raw shape). A full Zod schema, `undefined` or anything else yields `undefined`,
 * and the tool is registered exactly as before.
 */
export function readInputShape(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.parse === 'function' || '_zod' in candidate || '_def' in candidate) return undefined;
  const entries = Object.entries(candidate);
  if (entries.length === 0) return undefined;
  return entries.every(([, entry]) => isZodSchema(entry)) ? candidate : undefined;
}

/**
 * A loose version of the tool's raw shape: unknown top-level keys survive validation so
 * `guardUnknownParams` can report them. Field-level validation is untouched.
 */
export function looseInputSchema(shape: Record<string, unknown>): unknown {
  const flavourV4 = Object.values(shape).some((entry) => (entry as { _zod?: unknown })?._zod !== undefined);
  if (flavourV4) return z4.looseObject(shape as z4.ZodRawShape);
  return z3.object(shape as z3.ZodRawShape).passthrough();
}

/**
 * Reject unknown top-level arguments with `UNKNOWN_PARAM`, then delegate unchanged.
 * Tools with no declared shape are not wrapped: without a shape every key would be unknown.
 */
export function guardUnknownParams(
  tool: string,
  allowed: readonly string[],
  handler: ToolHandler,
): ToolHandler {
  if (allowed.length === 0) return handler;
  const allowedSet = new Set(allowed);

  return (args, extra) => {
    if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
      const unknown = Object.keys(args as Record<string, unknown>).filter((key) => !allowedSet.has(key));
      if (unknown.length > 0) {
        const shown = unknown.slice(0, LABEL_LIMIT).map((key) => `"${key}"`).join(', ');
        const more = unknown.length > LABEL_LIMIT ? ` (+${unknown.length - LABEL_LIMIT} more)` : '';
        const suggestion = closestName(unknown[0], allowed);
        return errWith({
          code: 'UNKNOWN_PARAM',
          message: `${tool}: unknown argument${unknown.length > 1 ? 's' : ''} ${shown}${more}`,
          hint: suggestion
            ? `Did you mean "${suggestion}"? Allowed arguments: ${allowed.join(', ')}`
            : `Allowed arguments: ${allowed.join(', ')}`,
          details: { unknown, allowed, ...(suggestion ? { suggestion } : {}) },
        });
      }
    }
    return handler(args, extra);
  };
}
