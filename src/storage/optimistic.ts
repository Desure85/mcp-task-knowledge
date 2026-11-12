/** MU-02: optimistic version check shared by all TaskStore profiles. */
import { WorkflowError } from '../workflow.js';
import type { Task } from '../types.js';

export interface TaskVersionState {
  version: number;
  fieldVersions: Record<string, number>;
}

export function nextTaskVersion(
  existing: Task,
  patch: Record<string, unknown>,
  expectedVersion?: number,
): TaskVersionState {
  const currentVersion = existing.version ?? 1;
  const patchKeys = Object.keys(patch);
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    const conflicting = patchKeys.filter((key) => (existing.fieldVersions?.[key] ?? 0) > expectedVersion);
    if (expectedVersion > currentVersion || conflicting.length > 0) {
      const current = Object.fromEntries(
        patchKeys.map((key) => [key, (existing as unknown as Record<string, unknown>)[key]]),
      );
      throw new WorkflowError(
        'CONFLICT',
        'Task changed since expectedVersion',
        'Re-read the task and retry with its current version',
        {
          expectedVersion,
          currentVersion,
          fields: conflicting,
          current,
          diff: conflicting.map((key) => ({
            field: key,
            expected: patch[key],
            current: (existing as unknown as Record<string, unknown>)[key],
          })),
        },
      );
    }
  }
  const nextVersion = currentVersion + 1;
  return {
    version: nextVersion,
    fieldVersions: {
      ...(existing.fieldVersions ?? {}),
      ...Object.fromEntries(patchKeys.map((key) => [key, nextVersion])),
    },
  };
}
