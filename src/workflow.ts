import { readProjectMetadata } from './projects.js';

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface ProjectStatus {
  id: string;
  label: string;
  category: StatusCategory;
  color: string;
  order: number;
  archived?: boolean;
}

export interface ProjectWorkflow {
  statuses: ProjectStatus[];
  transitions?: Record<string, string[]>;
  closeStatus: string;
  initialStatuses: string[];
  /** True when the project still runs on the built-in status set. */
  isDefault: boolean;
}

export const STATUS_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export const DEFAULT_PROJECT_STATUSES: readonly ProjectStatus[] = [
  { id: 'pending', label: 'Pending', category: 'todo', color: 'st-todo', order: 0 },
  { id: 'in_progress', label: 'In progress', category: 'in_progress', color: 'st-doing', order: 1 },
  { id: 'completed', label: 'Completed', category: 'done', color: 'st-done', order: 2 },
  { id: 'closed', label: 'Closed', category: 'done', color: 'st-archive', order: 3 },
];

/**
 * Status written by dependency automation before projects had workflows.
 * It stays valid for old tasks but is not part of the default status set.
 */
export const LEGACY_BLOCKED_STATUS: ProjectStatus = {
  id: 'blocked',
  label: 'Blocked',
  category: 'in_progress',
  color: 'st-blocked',
  order: 9_999,
};

export class WorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }

  toPayload(): {
    code: string;
    message: string;
    hint?: string;
    details?: unknown;
    from?: string;
    to?: string;
    allowed?: string[];
    taskIds?: string[];
  } {
    const details = this.details as Record<string, unknown> | undefined;
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.code === 'TRANSITION_NOT_ALLOWED' && typeof details?.from === 'string'
        ? { from: details.from, to: details.to as string, allowed: details.allowed as string[] }
        : {}),
      ...(Array.isArray(details?.allowed) ? { allowed: details.allowed as string[] } : {}),
      ...(Array.isArray(details?.taskIds) ? { taskIds: details.taskIds as string[] } : {}),
    };
  }
}

function statusIds(statuses: ProjectStatus[]): string[] {
  return statuses.map((status) => status.id);
}

function isLegacyBlocked(id: string, statuses: ProjectStatus[] = []): boolean {
  return id === LEGACY_BLOCKED_STATUS.id && !statuses.some((status) => status.id === id);
}

function invalid(message: string, details?: unknown): never {
  throw new WorkflowError('INVALID_STATUSES', message, undefined, details);
}

export function normalizeStatuses(input: unknown): ProjectStatus[] {
  if (!Array.isArray(input) || input.length === 0) {
    invalid('statuses must be a non-empty array');
  }

  const seen = new Set<string>();
  const statuses: ProjectStatus[] = (input as unknown[]).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalid(`status at index ${index} must be an object`);
    }
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!STATUS_ID_RE.test(id)) {
      invalid(`status id '${id}' must match ${STATUS_ID_RE.source}`, { index, id });
    }
    if (seen.has(id)) invalid(`duplicate status id '${id}'`, { id });
    seen.add(id);

    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) invalid(`status '${id}' needs a non-empty label`, { id });

    const category = item.category;
    if (category !== 'todo' && category !== 'in_progress' && category !== 'done') {
      invalid(`status '${id}' has invalid category '${String(category)}'`, { id, category });
    }

    const color = typeof item.color === 'string' && item.color.trim() ? item.color.trim() : 'neutral';
    const order = typeof item.order === 'number' && Number.isInteger(item.order) && item.order >= 0
      ? item.order
      : index;

    return {
      id,
      label,
      category,
      color,
      order,
      ...(item.archived === true ? { archived: true } : {}),
    };
  });

  statuses.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const active = statuses.filter((status) => !status.archived);
  if (!active.some((status) => status.category === 'todo')) {
    invalid('statuses must contain at least one active todo status');
  }
  if (!active.some((status) => status.category === 'done')) {
    invalid('statuses must contain at least one active done status');
  }

  return statuses;
}

export function normalizeInitialStatuses(
  input: unknown,
  statuses: ProjectStatus[],
): string[] {
  const known = new Set(statusIds(statuses));
  if (input === undefined || input === null) {
    return statuses.filter((status) => !status.archived && status.category === 'todo').map((status) => status.id);
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw new WorkflowError('INVALID_INITIAL_STATUSES', 'initialStatuses must be a non-empty array');
  }
  const initial: string[] = [];
  for (const raw of input) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!known.has(id)) {
      throw new WorkflowError(
        'INVALID_INITIAL_STATUSES',
        `initial status '${id}' is not in the project status set`,
        `allowed: ${statusIds(statuses).join(', ')}`,
        { status: id, allowed: statusIds(statuses) },
      );
    }
    if (!initial.includes(id)) initial.push(id);
  }
  if (initial.length === 0) {
    throw new WorkflowError('INVALID_INITIAL_STATUSES', 'initialStatuses must contain at least one status');
  }
  return initial;
}

export function normalizeTransitions(
  input: unknown,
  statuses: ProjectStatus[],
  initialStatuses?: string[],
): Record<string, string[]> | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new WorkflowError('INVALID_TRANSITIONS', 'transitions must be an object of status ids to status ids');
  }

  const known = new Set(statusIds(statuses));
  const transitions: Record<string, string[]> = {};
  for (const [from, rawTargets] of Object.entries(input as Record<string, unknown>)) {
    if (!known.has(from)) {
      throw new WorkflowError('INVALID_TRANSITIONS', `transition source '${from}' is not a project status`, undefined, { from });
    }
    if (!Array.isArray(rawTargets)) {
      throw new WorkflowError('INVALID_TRANSITIONS', `transitions['${from}'] must be an array`, undefined, { from });
    }
    const targets: string[] = [];
    for (const raw of rawTargets) {
      const to = typeof raw === 'string' ? raw.trim() : '';
      if (!known.has(to)) {
        throw new WorkflowError(
          'INVALID_TRANSITIONS',
          `transition '${from}' points to unknown status '${to}'`,
          `allowed: ${[...known].join(', ')}`,
          { from, to },
        );
      }
      if (!targets.includes(to)) targets.push(to);
    }
    transitions[from] = targets;
  }

  const initial = initialStatuses && initialStatuses.length > 0
    ? initialStatuses
    : statuses.filter((status) => !status.archived && status.category === 'todo').map((status) => status.id);
  const all = statuses.filter((status) => !status.archived).map((status) => status.id);
  const reachable = new Set<string>(initial);
  const queue = [...initial];
  while (queue.length > 0) {
    const from = queue.shift()!;
    const targets = transitions[from] ?? all;
    for (const to of targets) {
      if (!reachable.has(to)) {
        reachable.add(to);
        queue.push(to);
      }
    }
  }
  const done = statuses.filter((status) => !status.archived && status.category === 'done').map((status) => status.id);
  const unreachable = done.filter((id) => !reachable.has(id));
  if (unreachable.length > 0) {
    throw new WorkflowError(
      'TRANSITIONS_UNREACHABLE_DONE',
      `done status(es) cannot be reached from the initial statuses: ${unreachable.join(', ')}`,
      'Add a path from an initial status to every done status.',
      { unreachable, initialStatuses: initial },
    );
  }

  return transitions;
}

export function resolveCloseStatus(statuses: ProjectStatus[], configured?: string): string {
  if (configured && statuses.some((status) => status.id === configured && status.category === 'done')) {
    return configured;
  }
  if (statuses.some((status) => status.id === 'closed' && status.category === 'done')) return 'closed';
  const firstDone = statuses.find((status) => !status.archived && status.category === 'done');
  if (!firstDone) {
    throw new WorkflowError('INVALID_CLOSE_STATUS', 'project has no done status to close into');
  }
  return firstDone.id;
}

export async function loadProjectWorkflow(project: string): Promise<ProjectWorkflow> {
  const meta = await readProjectMetadata(project);
  const hasCustomStatuses = Array.isArray(meta?.statuses) && meta.statuses.length > 0;
  const statuses = hasCustomStatuses
    ? normalizeStatuses(meta!.statuses)
    : DEFAULT_PROJECT_STATUSES.map((status) => ({ ...status }));
  const initialStatuses = normalizeInitialStatuses(meta?.initialStatuses, statuses);
  const transitions = normalizeTransitions(meta?.transitions, statuses, initialStatuses);
  const closeStatus = resolveCloseStatus(statuses, meta?.closeStatus);

  return {
    statuses,
    transitions,
    closeStatus,
    initialStatuses,
    isDefault: !hasCustomStatuses,
  };
}

export function statusIdsOf(workflow: ProjectWorkflow): string[] {
  return statusIds(workflow.statuses);
}

export function isLegacyStatus(workflow: ProjectWorkflow, id: string): boolean {
  return isLegacyBlocked(id, workflow.statuses);
}

export function isKnownStatus(workflow: ProjectWorkflow, id: string): boolean {
  return workflow.statuses.some((status) => status.id === id) || isLegacyStatus(workflow, id);
}

export function statusDefinition(workflow: ProjectWorkflow, id: string): ProjectStatus | undefined {
  return workflow.statuses.find((status) => status.id === id)
    ?? (isLegacyStatus(workflow, id) ? { ...LEGACY_BLOCKED_STATUS } : undefined);
}

export function statusCategory(workflow: ProjectWorkflow, id: string): StatusCategory | undefined {
  return statusDefinition(workflow, id)?.category;
}

export function isDone(workflow: ProjectWorkflow, id: string): boolean {
  return statusCategory(workflow, id) === 'done';
}

export function defaultStatusId(workflow: ProjectWorkflow): string {
  return workflow.statuses.find((status) => !status.archived && status.category === 'todo')?.id
    ?? workflow.statuses.find((status) => !status.archived)?.id
    ?? workflow.statuses[0].id;
}

export function closeStatusId(workflow: ProjectWorkflow): string {
  return workflow.closeStatus;
}

export function allowedStatusIds(workflow: ProjectWorkflow): string[] {
  const ids = statusIdsOf(workflow);
  if (!ids.includes(LEGACY_BLOCKED_STATUS.id)) ids.push(LEGACY_BLOCKED_STATUS.id);
  return ids;
}

export function assertStatusAllowed(
  workflow: ProjectWorkflow,
  id: string,
  options: { initial?: boolean } = {},
): void {
  if (!isKnownStatus(workflow, id)) {
    throw new WorkflowError(
      'STATUS_NOT_ALLOWED',
      `status '${id}' is not in the project status set`,
      `allowed: ${allowedStatusIds(workflow).join(', ')}`,
      { status: id, allowed: allowedStatusIds(workflow) },
    );
  }
  if (options.initial && !isLegacyStatus(workflow, id) && !workflow.initialStatuses.includes(id)) {
    throw new WorkflowError(
      'INITIAL_STATUS_NOT_ALLOWED',
      `status '${id}' is not an allowed initial status for new tasks`,
      `allowed initial statuses: ${workflow.initialStatuses.join(', ')}`,
      { status: id, allowed: workflow.initialStatuses },
    );
  }
}

export function allowedTransitions(workflow: ProjectWorkflow, from: string): string[] | undefined {
  if (!workflow.transitions) return undefined;
  return workflow.transitions[from] ?? allowedStatusIds(workflow);
}

export function assertTransition(workflow: ProjectWorkflow, from: string, to: string): void {
  if (from === to || isLegacyStatus(workflow, from) || isLegacyStatus(workflow, to)) return;
  const allowed = allowedTransitions(workflow, from);
  if (allowed === undefined || allowed.includes(to)) return;
  throw new WorkflowError(
    'TRANSITION_NOT_ALLOWED',
    `Transition from '${from}' to '${to}' is not allowed`,
    `allowed from '${from}': ${allowed.join(', ') || '(none)'}`,
    { from, to, allowed },
  );
}

export function workflowSummary(workflow: ProjectWorkflow): {
  projectStatuses: number;
  closeStatus: string;
  initialStatuses: string[];
  transitions: number | null;
} {
  return {
    projectStatuses: workflow.statuses.length,
    closeStatus: workflow.closeStatus,
    initialStatuses: workflow.initialStatuses,
    transitions: workflow.transitions ? Object.keys(workflow.transitions).length : null,
  };
}

// ─── Task types (V-03) ───────────────────────────────────────────────

export interface ProjectType {
  id: string;
  label: string;
  color: string;
  icon?: string;
}

export const TYPE_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export const DEFAULT_PROJECT_TYPES: readonly ProjectType[] = [
  { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
  { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
  { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
];

export const DEFAULT_TASK_TYPE = 'task';

function invalidTypes(message: string, details?: unknown): never {
  throw new WorkflowError('INVALID_TYPES', message, undefined, details);
}

export function normalizeTypes(input: unknown): ProjectType[] {
  if (!Array.isArray(input) || input.length === 0) {
    invalidTypes('types must be a non-empty array');
  }
  const seen = new Set<string>();
  return (input as unknown[]).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalidTypes(`type at index ${index} must be an object`);
    }
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!TYPE_ID_RE.test(id)) {
      invalidTypes(`type id '${id}' must match ${TYPE_ID_RE.source}`, { index, id });
    }
    if (seen.has(id)) invalidTypes(`duplicate type id '${id}'`, { id });
    seen.add(id);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) invalidTypes(`type '${id}' needs a non-empty label`, { id });
    const color = typeof item.color === 'string' && item.color.trim() ? item.color.trim() : 'ty-task';
    const icon = typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : undefined;
    return { id, label, color, ...(icon ? { icon } : {}) };
  });
}

export async function loadProjectTypes(project: string): Promise<{ types: ProjectType[]; isDefault: boolean }> {
  const meta = await readProjectMetadata(project);
  const hasCustomTypes = Array.isArray(meta?.types) && meta.types.length > 0;
  const types = hasCustomTypes
    ? normalizeTypes(meta!.types)
    : DEFAULT_PROJECT_TYPES.map((type) => ({ ...type }));
  return { types, isDefault: !hasCustomTypes };
}

export function defaultTypeId(types: ProjectType[]): string {
  return types.find((type) => type.id === DEFAULT_TASK_TYPE)?.id ?? types[0]?.id ?? DEFAULT_TASK_TYPE;
}

export function allowedTypeIds(types: ProjectType[]): string[] {
  return types.map((type) => type.id);
}

export function isKnownType(types: ProjectType[], id: string): boolean {
  return types.some((type) => type.id === id);
}

export function assertTypeAllowed(types: ProjectType[], id: string): void {
  if (!isKnownType(types, id)) {
    const allowed = allowedTypeIds(types);
    throw new WorkflowError(
      'TYPE_NOT_ALLOWED',
      `type '${id}' is not in the project type set`,
      `allowed: ${allowed.join(', ')}`,
      { type: id, allowed },
    );
  }
}

export function resolveTaskType(types: ProjectType[], requested?: string | null): string {
  if (requested === undefined || requested === null || requested === '') return defaultTypeId(types);
  const id = String(requested).trim();
  assertTypeAllowed(types, id);
  return id;
}
