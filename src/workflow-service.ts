import { readProjectMetadata, updateProjectMeta } from './projects.js';
import { listTasks, moveTasksToStatus, moveTasksToType } from './storage/tasks.js';
import {
  WorkflowError,
  loadProjectTypes,
  loadProjectWorkflow,
  normalizeInitialStatuses,
  normalizeStatuses,
  normalizeTransitions,
  normalizeTypes,
  resolveCloseStatus,
  type ProjectStatus,
  type ProjectType,
  type ProjectWorkflow,
} from './workflow.js';
import { withFileLock } from './fs.js';

export interface StatusSetInput {
  statuses: unknown;
  moveTo?: string;
  moves?: Record<string, string>;
  closeStatus?: string;
  initialStatuses?: string[];
}

export interface StatusesView {
  project: string;
  statuses: ProjectStatus[];
  closeStatus: string;
  initialStatuses: string[];
  defaults: boolean;
}

export interface TransitionsView {
  project: string;
  transitions: Record<string, string[]> | null;
  unrestricted: boolean;
}

export interface StatusMove {
  from: string;
  to: string;
  count: number;
}

export async function getProjectStatuses(project: string): Promise<StatusesView> {
  const workflow = await loadProjectWorkflow(project);
  return {
    project,
    statuses: workflow.statuses,
    closeStatus: workflow.closeStatus,
    initialStatuses: workflow.initialStatuses,
    defaults: workflow.isDefault,
  };
}

function statusIds(statuses: ProjectStatus[]): string[] {
  return statuses.map((status) => status.id);
}

export interface TypeSetInput {
  types: unknown;
  moveTo?: string;
  moves?: Record<string, string>;
}

export interface TypesView {
  project: string;
  types: ProjectType[];
  defaults: boolean;
}

export interface TypeMove {
  from: string;
  to: string;
  count: number;
}

export async function getProjectTypes(project: string): Promise<TypesView> {
  const { types, isDefault } = await loadProjectTypes(project);
  return { project, types, defaults: isDefault };
}

function typeIds(types: ProjectType[]): string[] {
  return types.map((type) => type.id);
}

function usedByType(tasks: Array<{ id: string; type?: string }>, type: string): string[] {
  return tasks.filter((task) => (task.type ?? 'task') === type).map((task) => task.id);
}

export async function setProjectTypes(project: string, input: TypeSetInput): Promise<TypesView & { moved: TypeMove[] }> {
  return withFileLock(`workflow:${project}`, async () => {
    const oldMeta = await readProjectMetadata(project);
    const oldTypes = (await loadProjectTypes(project)).types;
    const types = normalizeTypes(input.types);
    const nextIds = new Set(typeIds(types));
    const oldIds = new Set(typeIds(oldTypes));
    const tasks = await listTasks({ project, includeArchived: true, includeTrashed: true });

    const removed = oldTypes.map((type) => type.id).filter((id) => oldIds.has(id) && !nextIds.has(id));
    const movedByTarget = new Map<string, { from: string; ids: string[] }>();
    const blockedRemovals: Array<{ type: string; taskIds: string[]; total: number }> = [];

    for (const from of removed) {
      const ids = usedByType(tasks, from);
      if (ids.length === 0) continue;
      const target = input.moves?.[from] ?? input.moveTo;
      if (!target) {
        blockedRemovals.push({ type: from, taskIds: ids.slice(0, 20), total: ids.length });
        continue;
      }
      if (!nextIds.has(target)) {
        throw new WorkflowError(
          'INVALID_MOVE_TARGET',
          `move target '${target}' for '${from}' is not in the new type set`,
          `allowed: ${[...nextIds].join(', ')}`,
          { from, to: target, allowed: [...nextIds] },
        );
      }
      const group = movedByTarget.get(target) ?? { from, ids: [] };
      group.ids.push(...ids);
      movedByTarget.set(target, group);
    }

    if (blockedRemovals.length > 0) {
      const first = blockedRemovals[0];
      throw new WorkflowError(
        'TYPE_IN_USE',
        `type '${first.type}' is used by ${first.total} task(s); move them first`,
        `pass moveTo='<type>' or moves={'${first.type}':'<type>'}`,
        { types: blockedRemovals, taskIds: first.taskIds, total: blockedRemovals.reduce((n, item) => n + item.total, 0) },
      );
    }

    const rollback = { types: oldMeta?.types ?? null };
    await updateProjectMeta(project, { types });

    const moved: TypeMove[] = [];
    try {
      for (const [to, group] of movedByTarget) {
        const updated = await moveTasksToType(project, group.ids, to);
        moved.push({ from: group.from, to, count: updated.length });
      }
    } catch (error) {
      await updateProjectMeta(project, rollback).catch(() => undefined);
      throw error;
    }

    return { project, types, defaults: false, moved };
  });
}

function usedTaskIds(tasks: Array<{ id: string; status: string }>, status: string): string[] {
  return tasks.filter((task) => task.status === status).map((task) => task.id);
}

export async function setProjectStatuses(project: string, input: StatusSetInput): Promise<StatusesView & { moved: StatusMove[] }> {
  return withFileLock(`workflow:${project}`, async () => {
    const oldMeta = await readProjectMetadata(project);
    const oldWorkflow = await loadProjectWorkflow(project);
    const statuses = normalizeStatuses(input.statuses);
    const nextIds = new Set(statusIds(statuses));
    const oldIds = new Set(statusIds(oldWorkflow.statuses));
    const tasks = await listTasks({ project, includeArchived: true, includeTrashed: true });

    const removed = oldWorkflow.statuses
      .map((status) => status.id)
      .filter((id) => oldIds.has(id) && !nextIds.has(id));
    const movedByTarget = new Map<string, { from: string; ids: string[] }>();
    const blockedRemovals: Array<{ status: string; taskIds: string[]; total: number }> = [];

    for (const from of removed) {
      const ids = usedTaskIds(tasks, from);
      if (ids.length === 0) continue;
      const target = input.moves?.[from] ?? input.moveTo;
      if (!target) {
        blockedRemovals.push({ status: from, taskIds: ids.slice(0, 20), total: ids.length });
        continue;
      }
      if (!nextIds.has(target)) {
        throw new WorkflowError(
          'INVALID_MOVE_TARGET',
          `move target '${target}' for '${from}' is not in the new status set`,
          `allowed: ${[...nextIds].join(', ')}`,
          { from, to: target, allowed: [...nextIds] },
        );
      }
      const group = movedByTarget.get(target) ?? { from, ids: [] };
      group.ids.push(...ids);
      movedByTarget.set(target, group);
    }

    if (blockedRemovals.length > 0) {
      const first = blockedRemovals[0];
      throw new WorkflowError(
        'STATUS_IN_USE',
        `status '${first.status}' is used by ${first.total} task(s); move them first`,
        `pass moveTo='<status>' or moves={'${first.status}':'<status>'}`,
        { statuses: blockedRemovals, taskIds: first.taskIds, total: blockedRemovals.reduce((n, item) => n + item.total, 0) },
      );
    }

    let initialStatuses: string[];
    if (input.initialStatuses !== undefined) {
      initialStatuses = normalizeInitialStatuses(input.initialStatuses, statuses);
    } else if (oldMeta?.initialStatuses?.length) {
      try {
        initialStatuses = normalizeInitialStatuses(oldMeta.initialStatuses, statuses);
      } catch {
        initialStatuses = normalizeInitialStatuses(undefined, statuses);
      }
    } else {
      initialStatuses = normalizeInitialStatuses(undefined, statuses);
    }
    const closeStatus = resolveCloseStatus(statuses, input.closeStatus ?? oldMeta?.closeStatus);
    const transitions = normalizeTransitions(oldMeta?.transitions, statuses, initialStatuses);

    const rollback = {
      statuses: oldMeta?.statuses ?? null,
      transitions: oldMeta?.transitions ?? null,
      closeStatus: oldMeta?.closeStatus ?? null,
      initialStatuses: oldMeta?.initialStatuses ?? null,
    };

    await updateProjectMeta(project, {
      statuses,
      initialStatuses,
      closeStatus,
      ...(transitions !== undefined ? { transitions } : {}),
    });

    const moved: StatusMove[] = [];
    try {
      for (const [to, group] of movedByTarget) {
        const updated = await moveTasksToStatus(project, group.ids, to);
        moved.push({ from: group.from, to, count: updated.length });
      }
    } catch (error) {
      await updateProjectMeta(project, rollback).catch(() => undefined);
      throw error;
    }

    return {
      project,
      statuses,
      closeStatus,
      initialStatuses,
      defaults: false,
      moved,
    };
  });
}

export async function getProjectTransitions(project: string): Promise<TransitionsView> {
  const workflow: ProjectWorkflow = await loadProjectWorkflow(project);
  return {
    project,
    transitions: workflow.transitions ?? null,
    unrestricted: workflow.transitions === undefined,
  };
}

export async function setProjectTransitions(
  project: string,
  transitions: Record<string, string[]> | null,
): Promise<TransitionsView> {
  return withFileLock(`workflow:${project}`, async () => {
    const workflow = await loadProjectWorkflow(project);
    const normalized = normalizeTransitions(transitions, workflow.statuses, workflow.initialStatuses);
    await updateProjectMeta(project, { transitions: normalized ?? null });
    return {
      project,
      transitions: normalized ?? null,
      unrestricted: normalized === undefined,
    };
  });
}
