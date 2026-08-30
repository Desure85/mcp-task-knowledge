/**
 * sync/conflict-resolver.ts — 3-way merge conflict resolver (SYNC-003)
 *
 * Resolves conflicts when two instances modify the same entity concurrently.
 * Uses a 3-way merge: base (common ancestor) + local + remote → merged result.
 * Field-level merge: non-conflicting fields auto-merge; conflicting fields
 * use a strategy (last-write-wins by default, or field-specific rules).
 */

export type MergeStrategy = 'last-write-wins' | 'local-wins' | 'remote-wins' | 'manual';

export interface MergeInput<T> {
  /** Common ancestor (last synced state). */
  base: T | null;
  /** Local changes. */
  local: T;
  /** Remote changes. */
  remote: T;
}

export interface MergeResult<T> {
  /** Merged entity. */
  merged: T;
  /** Whether a conflict was detected. */
  conflict: boolean;
  /** Conflicting field names (if any). */
  conflictingFields: string[];
  /** Strategy used. */
  strategy: MergeStrategy;
}

/**
 * Perform a 3-way field-level merge.
 * For each field:
 *   - If local == remote → no conflict, take either
 *   - If base == local → remote changed, take remote
 *   - If base == remote → local changed, take local
 *   - If both changed differently → conflict, apply strategy
 */
export function threeWayMerge<T extends Record<string, unknown>>(
  input: MergeInput<T>,
  strategy: MergeStrategy = 'last-write-wins',
): MergeResult<T> {
  const { base, local, remote } = input;
  const conflictingFields: string[] = [];
  const merged: Record<string, unknown> = {};

  const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const key of allKeys) {
    const localVal = local[key];
    const remoteVal = remote[key];
    const baseVal = base?.[key];

    if (deepEqual(localVal, remoteVal)) {
      merged[key] = localVal;
    } else if (deepEqual(baseVal, localVal)) {
      // Local unchanged, remote changed → take remote
      merged[key] = remoteVal;
    } else if (deepEqual(baseVal, remoteVal)) {
      // Remote unchanged, local changed → take local
      merged[key] = localVal;
    } else {
      // Both changed differently → conflict
      conflictingFields.push(key);
      switch (strategy) {
        case 'local-wins':
          merged[key] = localVal;
          break;
        case 'remote-wins':
          merged[key] = remoteVal;
          break;
        case 'manual':
          merged[key] = null; // requires human resolution
          break;
        case 'last-write-wins':
        default:
          // Compare timestamps if available, otherwise prefer remote
          const localTs = (local as { updatedAt?: string }).updatedAt;
          const remoteTs = (remote as { updatedAt?: string }).updatedAt;
          if (localTs && remoteTs) {
            merged[key] = localTs >= remoteTs ? localVal : remoteVal;
          } else {
            merged[key] = remoteVal;
          }
          break;
      }
    }
  }

  return {
    merged: merged as T,
    conflict: conflictingFields.length > 0,
    conflictingFields,
    strategy,
  };
}

/** Deep equality check (handles primitives, arrays, plain objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
