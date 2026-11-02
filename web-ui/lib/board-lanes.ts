/**
 * V-05 lane logic: split the board by task type, resolve the type selection
 * and persist lane preferences per project. Pure — storage is injected.
 */

import type { ProjectType, Task } from './api-client';

export interface LanePrefs {
  /** Explicit type ids; an empty list means "all types". */
  selectedTypes: string[];
  collapsedLanes: string[];
  showEmptyLanes: boolean;
}

export interface LanePrefsRead {
  prefs: LanePrefs;
  /** False when the project has no stored prefs yet (used for the mobile default). */
  stored: boolean;
}

export interface Lane {
  id: string;
  label: string;
  color?: string;
  icon?: string;
  tasks: Task[];
  /** False for the synthetic "Other" lane (tasks with an unknown type). */
  known: boolean;
}

export const LANES_PREFS_PREFIX = 'mcp.tasksBoardLanes.';
export const DEFAULT_TASK_TYPE = 'task';
export const OTHER_LANE_ID = 'other';
export const OTHER_LANE_LABEL = 'Other';

type ReadStorage = { getItem(key: string): string | null };
type WriteStorage = { setItem(key: string, value: string): void };

function defaultReadStorage(): ReadStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function defaultWriteStorage(): WriteStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function lanesPrefsKey(project: string): string {
  return `${LANES_PREFS_PREFIX}${project}`;
}

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Read lane prefs; any problem degrades to "all types, nothing collapsed". */
export function readLanePrefs(
  project: string,
  storage: ReadStorage | null = defaultReadStorage(),
): LanePrefsRead {
  const empty: LanePrefs = { selectedTypes: [], collapsedLanes: [], showEmptyLanes: false };
  if (!storage) return { prefs: empty, stored: false };
  try {
    const raw = storage.getItem(lanesPrefsKey(project));
    if (!raw) return { prefs: empty, stored: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { prefs: empty, stored: true };
    }
    const record = parsed as Record<string, unknown>;
    return {
      prefs: {
        selectedTypes: sanitizeIds(record.selectedTypes),
        collapsedLanes: sanitizeIds(record.collapsedLanes),
        showEmptyLanes: record.showEmptyLanes === true,
      },
      stored: true,
    };
  } catch {
    return { prefs: empty, stored: false };
  }
}

/** Persist lane prefs; blocked storage is a no-op, never a crash. */
export function writeLanePrefs(
  project: string,
  prefs: LanePrefs,
  storage: WriteStorage | null = defaultWriteStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      lanesPrefsKey(project),
      JSON.stringify({
        selectedTypes: sanitizeIds(prefs.selectedTypes),
        collapsedLanes: sanitizeIds(prefs.collapsedLanes),
        showEmptyLanes: prefs.showEmptyLanes === true,
      }),
    );
  } catch {
    /* storage blocked or full — the board keeps working in memory */
  }
}

/** Tasks without a type are `task`, exactly like the server. */
export function taskTypeId(task: Pick<Task, 'type'>): string {
  const value = typeof task.type === 'string' ? task.type.trim() : '';
  return value || DEFAULT_TASK_TYPE;
}

/** Drop ids of types that no longer exist; an empty result means "all". */
export function reconcileSelectedTypes(types: ProjectType[], selected: string[]): string[] {
  const known = new Set(types.map((type) => type.id));
  return sanitizeIds(selected).filter((id) => known.has(id));
}

/** Explicit type ids in the project's declared order (empty selection = all). */
export function resolveSelectedTypes(types: ProjectType[], selected: string[]): string[] {
  const explicit = reconcileSelectedTypes(types, selected);
  if (explicit.length === 0) return types.map((type) => type.id);
  return types.map((type) => type.id).filter((id) => explicit.includes(id));
}

/**
 * Split tasks into lanes: one per selected type, in the project order, plus a
 * single "Other" lane for tasks whose type is not in the project set (only when
 * the selection covers all types). Empty lanes are hidden unless asked for.
 */
export function buildLanes(
  types: ProjectType[],
  tasks: Task[],
  options: { selected?: string[]; showEmpty?: boolean } = {},
): Lane[] {
  const selected = options.selected ?? [];
  const showEmpty = options.showEmpty === true;
  const allTypes = selected.length === 0;
  const selectedIds = resolveSelectedTypes(types, selected);
  const selectedSet = new Set(selectedIds);
  const knownIds = new Set(types.map((type) => type.id));

  const grouped = new Map<string, Task[]>();
  const other: Task[] = [];
  for (const task of tasks) {
    const typeId = taskTypeId(task);
    if (!knownIds.has(typeId)) {
      if (allTypes) other.push(task);
      continue;
    }
    if (!selectedSet.has(typeId)) continue;
    const bucket = grouped.get(typeId);
    if (bucket) bucket.push(task);
    else grouped.set(typeId, [task]);
  }

  const lanes: Lane[] = [];
  for (const type of types) {
    if (!selectedSet.has(type.id)) continue;
    const laneTasks = grouped.get(type.id) ?? [];
    if (!showEmpty && laneTasks.length === 0) continue;
    lanes.push({
      id: type.id,
      label: type.label,
      ...(type.color ? { color: type.color } : {}),
      ...(type.icon ? { icon: type.icon } : {}),
      tasks: laneTasks,
      known: true,
    });
  }

  if (other.length > 0) {
    lanes.push({ id: OTHER_LANE_ID, label: OTHER_LANE_LABEL, tasks: other, known: false });
  }

  return lanes;
}

const TYPE_TONE_BY_COLOR: Record<string, string> = {
  'ty-task': 'bg-ty-task',
  'ty-bug': 'bg-ty-bug',
  'ty-feature': 'bg-ty-feature',
};

/**
 * Token class for a type dot/badge. Type colours are token names
 * (`ty-bug`), never raw colours; unknown values fall back to `ty-task`.
 */
export function typeDotClass(type: Pick<ProjectType, 'color'> | undefined): string {
  const color = type && typeof type.color === 'string' ? type.color.trim() : '';
  return TYPE_TONE_BY_COLOR[color] ?? 'bg-ty-task';
}

/** Mobile starts with every lane folded; the caller persists it on first render. */
export function defaultCollapsedLanes(lanes: Lane[]): string[] {
  return lanes.map((lane) => lane.id);
}
