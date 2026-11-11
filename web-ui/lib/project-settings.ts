/**
 * web-ui/lib/project-settings.ts — pure draft logic for UI-35 project settings.
 *
 * The screen edits three server resources (statuses, transitions, types) with a
 * single rule: nothing is sent until Save, and Save sends exactly one request
 * per tab. All of that bookkeeping — reordering, dirty detection, client-side
 * validation, transition-matrix materialisation and the *client mirror* of the
 * server's reachability rule — lives here so it is testable without a DOM.
 *
 * Server contract mirrored from `src/workflow.ts`:
 *   - status ids match STATUS_ID_RE, labels are non-empty, categories are
 *     todo/in_progress/done, `order` sorts the set, an archived status is
 *     hidden but stays addressable by old tasks;
 *   - a status set needs at least one active todo and one active done status;
 *   - `closeStatus` must be a done status;
 *   - `initialStatuses` must be known, non-empty, and default to active todos;
 *   - `transitions` maps a source status to its allowed targets, a missing key
 *     means "any active status", and `null` means any-to-any;
 *   - every active done status must be reachable from an initial status.
 *
 * The client checks are a *hint*: the server stays the authority and its error
 * codes (STATUS_IN_USE, INVALID_TRANSITIONS, TRANSITIONS_UNREACHABLE_DONE, …)
 * are surfaced by the page verbatim.
 */

import type { ProjectStatus, ProjectType, StatusCategory } from './api-client';
import { HUE_COLOR_TOKENS, THEME_COLOR_TOKENS } from './theme-pairs';

/** Same shape as `STATUS_ID_RE` / `TYPE_ID_RE` on the server. */
export const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

const LEGACY_STATUS_COLORS = ['st-todo', 'st-doing', 'st-review', 'st-blocked', 'st-done', 'st-archive'] as const;
const LEGACY_TYPE_COLORS = ['ty-task', 'ty-bug', 'ty-feature'] as const;

/**
 * Status colours are token *names*, never raw colours (DESIGN.md §3, §7): the
 * board resolves them through `statusDotClass`. UI-40 adds hue tokens plus
 * semantic theme links; the original six stay valid for existing projects.
 */
export const STATUS_COLOR_TOKENS = [
  ...LEGACY_STATUS_COLORS,
  ...HUE_COLOR_TOKENS,
  ...THEME_COLOR_TOKENS,
] as const;

/** Type colours share the UI-40 palette, with the original `ty-*` names kept. */
export const TYPE_COLOR_TOKENS = [
  ...LEGACY_TYPE_COLORS,
  ...HUE_COLOR_TOKENS,
  ...THEME_COLOR_TOKENS,
] as const;

/** Glyphs shipped by `components/board/TypeIcon.tsx`; anything else falls back to `task`. */
export const TYPE_ICONS = ['task', 'bug', 'feature'] as const;

export const STATUS_CATEGORIES: ReadonlyArray<{ value: StatusCategory; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export const CATEGORY_COLOR: Record<StatusCategory, string> = {
  todo: 'st-todo',
  in_progress: 'st-doing',
  done: 'st-done',
};

/** Label shown for a status/type id, falling back to the id itself. */
export function labelOf(items: ReadonlyArray<{ id: string; label?: string }>, id: string): string {
  return items.find((item) => item.id === id)?.label ?? id;
}

// ─── Draft shapes ────────────────────────────────────────────────────

export interface StatusesDraft {
  statuses: ProjectStatus[];
  closeStatus: string;
  initialStatuses: string[];
}

export interface TypesDraft {
  types: ProjectType[];
}

export interface TransitionsDraft {
  /** `null` = any status may move to any other (the server's "unrestricted"). */
  transitions: Record<string, string[]> | null;
}

export interface StatusesViewLike {
  statuses: ProjectStatus[];
  closeStatus: string;
  initialStatuses: string[];
}

export interface TransitionsViewLike {
  transitions: Record<string, string[]> | null;
  unrestricted: boolean;
}

export interface TypesViewLike {
  types: ProjectType[];
}

/** Copy a server view into a draft with `order` renumbered 0..n-1. */
export function statusesDraftFrom(view: StatusesViewLike): StatusesDraft {
  const statuses = withOrder(view.statuses.map((status) => ({ ...status })));
  const done = statuses.filter((status) => !status.archived && status.category === 'done');
  const closeStatus = done.some((status) => status.id === view.closeStatus)
    ? view.closeStatus
    : (done[0]?.id ?? '');
  const known = new Set(statuses.map((status) => status.id));
  const initialStatuses = view.initialStatuses.filter((id) => known.has(id));
  return {
    statuses,
    closeStatus,
    initialStatuses: initialStatuses.length > 0 ? initialStatuses : defaultInitialStatuses(statuses),
  };
}

export function typesDraftFrom(view: TypesViewLike): TypesDraft {
  return { types: view.types.map((type) => ({ ...type })) };
}

export function transitionsDraftFrom(view: TransitionsViewLike): TransitionsDraft {
  if (view.unrestricted || view.transitions === null) return { transitions: null };
  return { transitions: cloneTransitions(view.transitions) };
}

export function cloneTransitions(source: Record<string, string[]>): Record<string, string[]> {
  const copy: Record<string, string[]> = {};
  for (const [from, targets] of Object.entries(source)) copy[from] = [...targets];
  return copy;
}

export function defaultInitialStatuses(statuses: ReadonlyArray<ProjectStatus>): string[] {
  return statuses.filter((status) => !status.archived && status.category === 'todo').map((status) => status.id);
}

export function activeStatuses(statuses: ReadonlyArray<ProjectStatus>): ProjectStatus[] {
  return statuses.filter((status) => !status.archived);
}

// ─── Ordering (drag & drop and the keyboard buttons share this) ───────

/** Renumber `order` to the array position; the server sorts by it. */
export function withOrder(statuses: ReadonlyArray<ProjectStatus>): ProjectStatus[] {
  return statuses.map((status, index) => ({ ...status, order: index }));
}

function move<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Move one row up (-1) or down (+1); an edge move is a no-op. */
export function moveStatus(statuses: ReadonlyArray<ProjectStatus>, index: number, delta: -1 | 1): ProjectStatus[] {
  return withOrder(move(statuses, index, index + delta));
}

/** Drag & drop: drop row `from` onto the position of row `to`. */
export function moveStatusTo(statuses: ReadonlyArray<ProjectStatus>, from: number, to: number): ProjectStatus[] {
  return withOrder(move(statuses, from, to));
}

export function moveType(types: ReadonlyArray<ProjectType>, index: number, delta: -1 | 1): ProjectType[] {
  return move(types, index, index + delta);
}

export function moveTypeTo(types: ReadonlyArray<ProjectType>, from: number, to: number): ProjectType[] {
  return move(types, from, to);
}

// ─── Editing helpers ─────────────────────────────────────────────────

/** Slug for a new status/type id: lowercase, ASCII, `_`/`-` kept, unique. */
export function idFromLabel(label: string, existing: ReadonlyArray<string>, fallback = 'status'): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_')
      .slice(0, 32) || fallback;
  const head = /^[a-z]/.test(base) ? base : `${fallback}_${base}`.slice(0, 32);
  if (!existing.includes(head)) return head;
  for (let n = 2; n < 100; n++) {
    const suffix = `_${n}`;
    const candidate = `${head.slice(0, 32 - suffix.length)}${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${fallback}_${Date.now().toString(36)}`;
}

export function updateStatus(
  statuses: ReadonlyArray<ProjectStatus>,
  id: string,
  patch: Partial<ProjectStatus>,
): ProjectStatus[] {
  return withOrder(statuses.map((status) => (status.id === id ? { ...status, ...patch } : status)));
}

export function updateType(types: ReadonlyArray<ProjectType>, id: string, patch: Partial<ProjectType>): ProjectType[] {
  return types.map((type) => (type.id === id ? { ...type, ...patch } : type));
}

/** Remove statuses from every reference that would otherwise dangle. */
export function withoutStatuses(draft: StatusesDraft, ids: ReadonlyArray<string>): StatusesDraft {
  const drop = new Set(ids);
  const statuses = withOrder(draft.statuses.filter((status) => !drop.has(status.id)));
  const done = statuses.filter((status) => !status.archived && status.category === 'done');
  const initialStatuses = draft.initialStatuses.filter((id) => !drop.has(id));
  return {
    statuses,
    closeStatus: done.some((status) => status.id === draft.closeStatus)
      ? draft.closeStatus
      : (done[0]?.id ?? ''),
    initialStatuses: initialStatuses.length > 0 ? initialStatuses : defaultInitialStatuses(statuses),
  };
}

export function withoutTypes(draft: TypesDraft, ids: ReadonlyArray<string>): TypesDraft {
  const drop = new Set(ids);
  return { types: draft.types.filter((type) => !drop.has(type.id)) };
}

// ─── Dirty detection ─────────────────────────────────────────────────

function sortedUnique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort();
}

function sameStatuses(a: ReadonlyArray<ProjectStatus>, b: ReadonlyArray<ProjectStatus>): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    if (!right) return false;
    return (
      left.id === right.id &&
      left.label.trim() === right.label.trim() &&
      left.category === right.category &&
      (left.color ?? '') === (right.color ?? '') &&
      (left.order ?? index) === (right.order ?? index) &&
      Boolean(left.archived) === Boolean(right.archived)
    );
  });
}

export function statusesDirty(draft: StatusesDraft, baseline: StatusesDraft): boolean {
  if (!sameStatuses(withOrder(draft.statuses), withOrder(baseline.statuses))) return true;
  if (draft.closeStatus !== baseline.closeStatus) return true;
  return sortedUnique(draft.initialStatuses).join(',') !== sortedUnique(baseline.initialStatuses).join(',');
}

function sameTypes(a: ReadonlyArray<ProjectType>, b: ReadonlyArray<ProjectType>): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    if (!right) return false;
    return (
      left.id === right.id &&
      left.label.trim() === right.label.trim() &&
      (left.color ?? '') === (right.color ?? '') &&
      (left.icon ?? '') === (right.icon ?? '')
    );
  });
}

export function typesDirty(draft: TypesDraft, baseline: TypesDraft): boolean {
  return !sameTypes(draft.types, baseline.types);
}

export function transitionsDirty(draft: TransitionsDraft, baseline: TransitionsDraft): boolean {
  return canonicalTransitions(draft.transitions) !== canonicalTransitions(baseline.transitions);
}

/** Stable string form: `null` stays distinct from an explicit graph. */
export function canonicalTransitions(transitions: Record<string, string[]> | null): string {
  if (transitions === null) return 'any';
  return Object.keys(transitions)
    .sort()
    .map((from) => `${from}:${sortedUnique(transitions[from] ?? []).join('|')}`)
    .join(';');
}

/** Ids that exist in the baseline but not in the draft (i.e. the user deleted them). */
export function removedIds(
  baseline: ReadonlyArray<{ id: string }>,
  draft: ReadonlyArray<{ id: string }>,
): string[] {
  const keep = new Set(draft.map((item) => item.id));
  return baseline.map((item) => item.id).filter((id) => !keep.has(id));
}

// ─── Client-side validation (hints; the server is the authority) ───────

export function validateStatusDraft(draft: StatusesDraft): string[] {
  const issues: string[] = [];
  if (draft.statuses.length === 0) issues.push('Add at least one status.');
  const seen = new Set<string>();
  for (const status of draft.statuses) {
    if (!ID_RE.test(status.id)) {
      issues.push(`Status id "${status.id}" must start with a letter and use lowercase letters, digits, "-" or "_".`);
    }
    if (seen.has(status.id)) issues.push(`Duplicate status id "${status.id}".`);
    seen.add(status.id);
    if (!status.label.trim()) issues.push(`Status "${status.id}" needs a name.`);
  }
  const active = activeStatuses(draft.statuses);
  if (active.length > 0) {
    if (!active.some((status) => status.category === 'todo')) {
      issues.push('At least one active status must have the "To do" category.');
    }
    if (!active.some((status) => status.category === 'done')) {
      issues.push('At least one active status must have the "Done" category.');
    }
  }
  const known = new Set(draft.statuses.map((status) => status.id));
  const done = active.filter((status) => status.category === 'done').map((status) => status.id);
  if (!draft.closeStatus) {
    issues.push('Choose the status used when a task is closed.');
  } else if (!done.includes(draft.closeStatus)) {
    issues.push('The close status must be an active "Done" status.');
  }
  if (draft.initialStatuses.length === 0) {
    issues.push('Choose at least one status for new tasks.');
  }
  for (const id of draft.initialStatuses) {
    if (!known.has(id)) issues.push(`Initial status "${id}" is not in the status set.`);
  }
  return issues;
}

export function validateTypesDraft(draft: TypesDraft): string[] {
  const issues: string[] = [];
  if (draft.types.length === 0) issues.push('Add at least one task type.');
  const seen = new Set<string>();
  for (const type of draft.types) {
    if (!ID_RE.test(type.id)) {
      issues.push(`Type id "${type.id}" must start with a letter and use lowercase letters, digits, "-" or "_".`);
    }
    if (seen.has(type.id)) issues.push(`Duplicate type id "${type.id}".`);
    seen.add(type.id);
    if (!type.label.trim()) issues.push(`Type "${type.id}" needs a name.`);
  }
  return issues;
}

// ─── Transition matrix ───────────────────────────────────────────────

/** Every active status may move to every active status. */
export function fullMatrix(statuses: ReadonlyArray<ProjectStatus>): Record<string, string[]> {
  const ids = activeStatuses(statuses).map((status) => status.id);
  const matrix: Record<string, string[]> = {};
  for (const from of ids) matrix[from] = [...ids];
  return matrix;
}

/**
 * The graph an explicit ("not unrestricted") draft must send: every active
 * status becomes a source key, so unchecking a box after switching the
 * "allow any transition" toggle off is honoured instead of silently inherited
 * from the server's "missing key = unrestricted" rule.
 */
export function materializeTransitions(
  draft: TransitionsDraft,
  statuses: ReadonlyArray<ProjectStatus>,
): Record<string, string[]> | null {
  if (draft.transitions === null) return null;
  const ids = activeStatuses(statuses).map((status) => status.id);
  const known = new Set(ids);
  const matrix: Record<string, string[]> = {};
  for (const from of ids) {
    const targets = (draft.transitions[from] ?? []).filter((to) => known.has(to) && to !== from);
    matrix[from] = targets;
  }
  // Keep rules for archived sources (they still exist on the server) and drop
  // anything unknown: the server rejects an unknown source with INVALID_TRANSITIONS.
  for (const [from, targets] of Object.entries(draft.transitions)) {
    if (matrix[from]) continue;
    if (!statuses.some((status) => status.id === from)) continue;
    matrix[from] = [...targets];
  }
  return matrix;
}

export function isTransitionAllowed(
  transitions: Record<string, string[]> | null,
  from: string,
  to: string,
): boolean {
  if (from === to) return false;
  if (transitions === null) return true;
  const targets = transitions[from];
  if (targets === undefined) return true; // missing key = unrestricted
  return targets.includes(to);
}

/** Toggle one cell, materialising the graph first so the click has an effect. */
export function toggleTransition(
  draft: TransitionsDraft,
  statuses: ReadonlyArray<ProjectStatus>,
  from: string,
  to: string,
): TransitionsDraft {
  if (from === to) return draft;
  const base = draft.transitions ?? fullMatrix(statuses);
  const targets = new Set(base[from] ?? activeStatuses(statuses).map((status) => status.id));
  if (targets.has(to)) targets.delete(to);
  else targets.add(to);
  return { transitions: { ...cloneTransitions(base), [from]: [...targets] } };
}

/** Set a whole column/row at once ("allow all from this status"). */
export function setRowTransitions(
  draft: TransitionsDraft,
  statuses: ReadonlyArray<ProjectStatus>,
  from: string,
  allowed: boolean,
): TransitionsDraft {
  const base = draft.transitions ?? fullMatrix(statuses);
  const ids = activeStatuses(statuses).map((status) => status.id).filter((id) => id !== from);
  return { transitions: { ...cloneTransitions(base), [from]: allowed ? ids : [] } };
}

/**
 * Client mirror of `normalizeTransitions` reachability: start from the initial
 * statuses, walk the graph, and report active done statuses that cannot be
 * reached. A missing key means "every active status", exactly like the server.
 */
export function unreachableDoneStatuses(
  statuses: ReadonlyArray<ProjectStatus>,
  initialStatuses: ReadonlyArray<string>,
  transitions: Record<string, string[]> | null,
): string[] {
  const active = activeStatuses(statuses);
  const all = active.map((status) => status.id);
  const done = active.filter((status) => status.category === 'done').map((status) => status.id);
  const initial = initialStatuses.length > 0 ? [...initialStatuses] : defaultInitialStatuses(statuses);
  const reachable = new Set(initial);
  const queue = [...initial];
  while (queue.length > 0) {
    const from = queue.shift() as string;
    const targets = transitions === null ? all : (transitions[from] ?? all);
    for (const to of targets) {
      if (!reachable.has(to)) {
        reachable.add(to);
        queue.push(to);
      }
    }
  }
  return done.filter((id) => !reachable.has(id));
}

/** Explanation next to the matrix, naming the status and the initial statuses. */
export function unreachableDoneMessage(
  statuses: ReadonlyArray<ProjectStatus>,
  unreachable: ReadonlyArray<string>,
  initialStatuses: ReadonlyArray<string>,
): string {
  const done = unreachable.map((id) => labelOf(statuses, id)).join(', ');
  const from = initialStatuses.map((id) => labelOf(statuses, id)).join(', ') || 'the initial statuses';
  return unreachable.length === 0
    ? ''
    : `Done status ${done} cannot be reached from ${from}. Allow a path to it before saving.`;
}

// ─── Payloads ────────────────────────────────────────────────────────

/** Exactly what `project_statuses_set` expects in `statuses`. */
export function statusesPayload(draft: StatusesDraft): ProjectStatus[] {
  return withOrder(draft.statuses).map((status) => ({
    id: status.id,
    label: status.label.trim(),
    category: status.category,
    color: status.color ?? CATEGORY_COLOR[status.category],
    order: status.order,
    ...(status.archived ? { archived: true } : {}),
  }));
}

/** Exactly what `project_types_set` expects in `types`. */
export function typesPayload(draft: TypesDraft): ProjectType[] {
  return draft.types.map((type) => ({
    id: type.id,
    label: type.label.trim(),
    color: type.color ?? 'ty-task',
    ...(type.icon ? { icon: type.icon } : {}),
  }));
}

/** `{ removedId: targetId }` for every blocked removal the user resolved. */
export function moveTargetsFor(blockedIds: ReadonlyArray<string>, target: string): Record<string, string> {
  const moves: Record<string, string> = {};
  for (const id of blockedIds) moves[id] = target;
  return moves;
}

// ─── Server error helpers ────────────────────────────────────────────

export interface BlockedRemovalLike {
  id: string;
  total: number;
  taskIds: string[];
}

/**
 * Read `details` of a `STATUS_IN_USE` / `TYPE_IN_USE` reply.
 *
 * Server shape (`src/workflow-service.ts`):
 *   { statuses|types: [{ status|type, taskIds: string[≤20], total }],
 *     taskIds: string[], total: number }
 * Anything unexpected degrades to an empty list so the page can fall back to
 * the plain error message instead of crashing on a shape change.
 */
export function parseInUseError(details: unknown, kind: 'status' | 'type'): BlockedRemovalLike[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const record = details as Record<string, unknown>;
  const list = record[kind === 'status' ? 'statuses' : 'types'];
  if (!Array.isArray(list)) return [];
  const blocked: BlockedRemovalLike[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item[kind] === 'string' ? (item[kind] as string) : '';
    if (!id) continue;
    const taskIds = Array.isArray(item.taskIds)
      ? item.taskIds.filter((value): value is string => typeof value === 'string')
      : [];
    const total = typeof item.total === 'number' && Number.isFinite(item.total) ? item.total : taskIds.length;
    blocked.push({ id, total, taskIds });
  }
  return blocked;
}

/** Human message from a `ToolCallError`-shaped failure (code + hint included). */
export function describeToolError(error: unknown): string {
  const candidate = error as { message?: unknown; code?: unknown; hint?: unknown } | null;
  const message = typeof candidate?.message === 'string' && candidate.message.trim() ? candidate.message : 'Request failed';
  const code = typeof candidate?.code === 'string' && candidate.code ? candidate.code : '';
  const hint = typeof candidate?.hint === 'string' && candidate.hint ? candidate.hint : '';
  return [code ? `${message} (${code})` : message, hint].filter(Boolean).join(' — ');
}

/**
 * Put back statuses the user deleted in this draft but that must survive
 * because a save was cancelled (the move dialog was dismissed). Existing rows
 * keep their edits; new rows stay where the user put them.
 */
export function restoreMissingStatuses(draft: StatusesDraft, baseline: StatusesDraft): StatusesDraft {
  const byId = new Map(draft.statuses.map((status) => [status.id, status]));
  const restored: ProjectStatus[] = baseline.statuses.map((status) => byId.get(status.id) ?? { ...status });
  const restoredIds = new Set(restored.map((status) => status.id));
  for (const status of draft.statuses) if (!restoredIds.has(status.id)) restored.push(status);
  const statuses = withOrder(restored);
  const known = new Set(statuses.map((status) => status.id));
  const initialStatuses = [...draft.initialStatuses];
  for (const id of baseline.initialStatuses) if (known.has(id) && !initialStatuses.includes(id)) initialStatuses.push(id);
  const draftDone = draft.statuses.filter((status) => !status.archived && status.category === 'done');
  const closeWasFallback = draftDone.length > 0 && draft.closeStatus === draftDone[0].id;
  const closeStatus =
    known.has(baseline.closeStatus) && closeWasFallback
      ? baseline.closeStatus
      : known.has(draft.closeStatus)
        ? draft.closeStatus
        : baseline.closeStatus;
  return {
    statuses,
    closeStatus,
    initialStatuses: initialStatuses.length > 0 ? initialStatuses : defaultInitialStatuses(statuses),
  };
}

export function restoreMissingTypes(draft: TypesDraft, baseline: TypesDraft): TypesDraft {
  const byId = new Map(draft.types.map((type) => [type.id, type]));
  const restored: ProjectType[] = baseline.types.map((type) => byId.get(type.id) ?? { ...type });
  const present = new Set(restored.map((type) => type.id));
  for (const type of draft.types) if (!present.has(type.id)) restored.push(type);
  return { types: restored };
}

/**
 * Removing a status that still appears in the transition graph makes the server
 * reject the whole status save with INVALID_TRANSITIONS — `setProjectStatuses`
 * validates the *old* graph against the *new* status set. The page therefore
 * blocks the save and points at the Transitions tab; this helper names the
 * offending statuses (source keys and targets alike).
 */
export function statusesReferencedByTransitions(
  baselineStatuses: ReadonlyArray<ProjectStatus>,
  draftStatuses: ReadonlyArray<ProjectStatus>,
  transitions: Record<string, string[]> | null,
): string[] {
  if (transitions === null) return [];
  const keep = new Set(draftStatuses.map((status) => status.id));
  const removed = new Set(baselineStatuses.map((status) => status.id).filter((id) => !keep.has(id)));
  if (removed.size === 0) return [];
  const referenced = new Set<string>();
  for (const [from, targets] of Object.entries(transitions)) {
    if (removed.has(from)) referenced.add(from);
    for (const to of targets) if (removed.has(to)) referenced.add(to);
  }
  return [...referenced];
}

/** Message shown instead of a doomed `project_statuses_set` request. */
export function transitionConflictMessage(
  statuses: ReadonlyArray<ProjectStatus>,
  referenced: ReadonlyArray<string>,
): string {
  if (referenced.length === 0) return '';
  const names = referenced.map((id) => labelOf(statuses, id)).join(', ');
  return `${names} still appear${referenced.length === 1 ? 's' : ''} in the transition graph. Remove the rule on the Transitions tab first, then save the statuses.`;
}

/** Human labels for the colour tokens; the value stays the token name. */
export const STATUS_COLOR_LABELS: Record<string, string> = {
  'st-todo': 'Neutral',
  'st-doing': 'Accent',
  'st-review': 'Secondary',
  'st-blocked': 'Danger',
  'st-done': 'Success',
  'st-archive': 'Muted',
  'st-slate': 'Slate',
  'st-blue': 'Blue',
  'st-indigo': 'Indigo',
  'st-violet': 'Violet',
  'st-pink': 'Pink',
  'st-red': 'Red',
  'st-orange': 'Orange',
  'st-amber': 'Amber',
  'st-green': 'Green',
  'st-teal': 'Teal',
  'st-cyan': 'Cyan',
  'st-gray': 'Gray',
  accent: 'Theme accent',
  success: 'Theme success',
  warning: 'Theme warning',
  danger: 'Theme danger',
  info: 'Theme info',
};

export const TYPE_COLOR_LABELS: Record<string, string> = {
  'ty-task': 'Neutral',
  'ty-bug': 'Danger',
  'ty-feature': 'Secondary',
  'st-slate': 'Slate',
  'st-blue': 'Blue',
  'st-indigo': 'Indigo',
  'st-violet': 'Violet',
  'st-pink': 'Pink',
  'st-red': 'Red',
  'st-orange': 'Orange',
  'st-amber': 'Amber',
  'st-green': 'Green',
  'st-teal': 'Teal',
  'st-cyan': 'Cyan',
  'st-gray': 'Gray',
  accent: 'Theme accent',
  success: 'Theme success',
  warning: 'Theme warning',
  danger: 'Theme danger',
  info: 'Theme info',
};

export const TYPE_ICON_LABELS: Record<string, string> = {
  task: 'Check square',
  bug: 'Bug',
  feature: 'Feature',
};
