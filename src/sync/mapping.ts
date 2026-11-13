/** INT-008: explicit, validated field/status mapping between local tasks and a tracker. */
import type { Priority } from '../types.js';

export interface ValueMap {
  local: string;
  external: string;
}

export interface SyncMapping {
  statuses: ValueMap[];
  priorities: ValueMap[];
}

export const DEFAULT_MAPPING: SyncMapping = {
  statuses: [
    { local: 'pending', external: 'pending' },
    { local: 'in_progress', external: 'in_progress' },
    { local: 'completed', external: 'completed' },
    { local: 'archived', external: 'archived' },
  ],
  priorities: [
    { local: 'low', external: 'low' },
    { local: 'medium', external: 'medium' },
    { local: 'high', external: 'high' },
  ],
};

function assertUnique(values: ValueMap[], side: 'local' | 'external', label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value[side]) throw new Error(`sync mapping: empty ${label} ${side} value`);
    if (seen.has(value[side])) throw new Error(`sync mapping: duplicate ${label} ${side} value '${value[side]}'`);
    seen.add(value[side]);
  }
}

export function validateMapping(mapping: SyncMapping): SyncMapping {
  assertUnique(mapping.statuses, 'local', 'status');
  assertUnique(mapping.statuses, 'external', 'status');
  assertUnique(mapping.priorities, 'local', 'priority');
  assertUnique(mapping.priorities, 'external', 'priority');
  return mapping;
}

export function localToExternal(mapping: SyncMapping, kind: 'status' | 'priority', value: string): string {
  const list = kind === 'status' ? mapping.statuses : mapping.priorities;
  return list.find((entry) => entry.local === value)?.external ?? value;
}

export function externalToLocal(mapping: SyncMapping, kind: 'status' | 'priority', value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const list = kind === 'status' ? mapping.statuses : mapping.priorities;
  return list.find((entry) => entry.external === value)?.local ?? value;
}

export function localPriority(value: string | undefined): Priority | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}
