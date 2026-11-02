/**
 * Pure board logic for V-04: project status columns, allowed transitions and
 * per-project column preferences. No React, no DOM — storage is injected so
 * the fallbacks are testable outside a browser.
 */

import type { ProjectStatus, StatusCategory } from './api-client';

export interface BoardPrefs {
  collapsed: string[];
  hidden: string[];
}

export interface BoardColumns {
  visible: ProjectStatus[];
  hidden: ProjectStatus[];
  collapsed: Set<string>;
}

export interface OverflowCues {
  left: boolean;
  right: boolean;
  hiddenLeft: number;
  hiddenRight: number;
}

export const BOARD_PREFS_PREFIX = 'mcp.tasksBoard.';
export const COLUMN_WIDTH = 264;
export const COLLAPSED_WIDTH = 48;
export const COLUMN_GAP = 12;

export function boardPrefsKey(project: string): string {
  return `${BOARD_PREFS_PREFIX}${project}`;
}

type ReadStorage = { getItem(key: string): string | null };
type WriteStorage = { setItem(key: string, value: string): void };

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

/** Read the column state for one project; any failure degrades to "all open". */
export function readBoardPrefs(
  project: string,
  storage: ReadStorage | null = defaultReadStorage(),
): BoardPrefs {
  if (!storage) return { collapsed: [], hidden: [] };
  try {
    const raw = storage.getItem(boardPrefsKey(project));
    if (!raw) return { collapsed: [], hidden: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { collapsed: [], hidden: [] };
    }
    const record = parsed as Record<string, unknown>;
    return { collapsed: sanitizeIds(record.collapsed), hidden: sanitizeIds(record.hidden) };
  } catch {
    return { collapsed: [], hidden: [] };
  }
}

/** Persist the column state; blocked storage is a no-op, never a crash. */
export function writeBoardPrefs(
  project: string,
  prefs: BoardPrefs,
  storage: WriteStorage | null = defaultWriteStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      boardPrefsKey(project),
      JSON.stringify({ collapsed: sanitizeIds(prefs.collapsed), hidden: sanitizeIds(prefs.hidden) }),
    );
  } catch {
    /* storage blocked or full — the board keeps working in memory */
  }
}

/** Status columns in the project's declared order (ties: label, then id). */
export function orderStatuses(statuses: ProjectStatus[]): ProjectStatus[] {
  return [...statuses].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

/** Ordered columns the board can show (archived statuses stay out of the board). */
export function activeStatuses(statuses: ProjectStatus[]): ProjectStatus[] {
  return orderStatuses(statuses.filter((status) => !status.archived));
}

/** Drop ids that no longer exist so a removed status cannot hide a new one. */
export function reconcilePrefs(statuses: ProjectStatus[], prefs: BoardPrefs): BoardPrefs {
  const known = new Set(statuses.map((status) => status.id));
  return {
    collapsed: prefs.collapsed.filter((id) => known.has(id)),
    hidden: prefs.hidden.filter((id) => known.has(id)),
  };
}

/** Split ordered statuses into visible (in order) and hidden columns. */
export function boardColumns(statuses: ProjectStatus[], prefs: BoardPrefs): BoardColumns {
  const ordered = activeStatuses(statuses);
  const clean = reconcilePrefs(ordered, prefs);
  const collapsed = new Set(clean.collapsed);
  const visible = ordered.filter((status) => !clean.hidden.includes(status.id));
  const hidden = ordered.filter((status) => clean.hidden.includes(status.id));
  return { visible, hidden, collapsed };
}

/**
 * Targets the UI may offer for a move, mirroring the server's
 * `allowedTransitions`: no graph = every status; a missing `from` key also
 * means every status; unknown/archived targets are filtered out and the
 * current status is never offered.
 */
export function allowedTargets(
  transitions: Record<string, string[]> | null | undefined,
  from: string,
  statuses: ProjectStatus[],
): string[] {
  const ordered = activeStatuses(statuses);
  const ids = ordered.map((status) => status.id);
  const allowed = transitions ? (transitions[from] ?? ids) : ids;
  const allowSet = new Set(allowed);
  return ids.filter((id) => id !== from && allowSet.has(id));
}

export function isAllowedTarget(
  transitions: Record<string, string[]> | null | undefined,
  from: string,
  to: string,
  statuses: ProjectStatus[],
): boolean {
  return allowedTargets(transitions, from, statuses).includes(to);
}

/**
 * Which side has off-screen columns for the "N more" cues. `widths` are the
 * rendered column widths (expanded or collapsed) in visual order.
 */
export function overflowCues(
  scrollLeft: number,
  clientWidth: number,
  widths: number[],
  gap: number = COLUMN_GAP,
): OverflowCues {
  const rightEdge = scrollLeft + Math.max(0, clientWidth);
  let x = 0;
  let hiddenLeft = 0;
  let hiddenRight = 0;
  let left = false;
  let right = false;

  widths.forEach((width, index) => {
    if (index > 0) x += gap;
    const start = x;
    const end = x + width;
    if (start < scrollLeft - 0.5) left = true;
    if (end > rightEdge + 0.5) right = true;
    if (end <= scrollLeft + 0.5) hiddenLeft += 1;
    if (start >= rightEdge - 0.5) hiddenRight += 1;
    x = end;
  });

  return { left, right, hiddenLeft, hiddenRight };
}

const TONE_BY_COLOR: Record<string, string> = {
  'st-todo': 'bg-st-todo',
  'st-doing': 'bg-st-doing',
  'st-review': 'bg-st-review',
  'st-blocked': 'bg-st-blocked',
  'st-done': 'bg-st-done',
  'st-archive': 'bg-st-archive',
};

const TONE_BY_CATEGORY: Record<StatusCategory, string> = {
  todo: 'bg-st-todo',
  in_progress: 'bg-st-doing',
  done: 'bg-st-done',
};

/**
 * Token class for a status dot. Status colours are token names (`st-review`),
 * never raw colours; unknown values fall back to the category colour.
 */
export function statusDotClass(status: Pick<ProjectStatus, 'color' | 'category'>): string {
  const color = typeof status.color === 'string' ? status.color.trim() : '';
  return TONE_BY_COLOR[color] ?? TONE_BY_CATEGORY[status.category] ?? 'bg-st-todo';
}
