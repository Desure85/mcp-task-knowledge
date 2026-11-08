/** Small string helpers shared by storage and tool-argument layers. */

/**
 * Treat a blank string as "the field is absent"; every other value passes through unchanged.
 *
 * AC-01: `tasks_bulk_create` with `parentId: ""` used to persist an empty `parentId`,
 * because `''` is falsy for the parent check but still a value for the writer.
 *
 * `null` is deliberately **not** normalised here: for documents `parentId: null` is the
 * documented way to detach a doc to the root (`tests/knowledge.detach_root.test.ts`), and
 * for tasks the caller converts `null` to `undefined` itself. Only `''`/`'   '` lose their
 * meaning, and only for id-like inputs — a description being cleared stays an empty string.
 */
export function blankToUndefined<T extends string | null | undefined>(value: T): T | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}
