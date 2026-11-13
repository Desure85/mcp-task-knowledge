/**
 * INT-008: one-cycle, idempotent two-way sync.
 *
 * Local-change detection uses a content hash of the mapped fields, not local
 * updatedAt: writing the external link itself bumps updatedAt, so timestamps
 * alone would make the next cycle look dirty forever. External-change
 * detection uses the tracker's updatedAt saved at the last sync.
 */
import { createHash } from 'node:crypto';
import type { Task } from '../types.js';
import { DEFAULT_MAPPING, externalToLocal, localPriority, localToExternal, validateMapping, type SyncMapping } from './mapping.js';
import type { ExternalTask, SyncResult, SyncTaskStore, TrackerAdapter } from './types.js';

export interface SyncOptions {
  project: string;
  store: SyncTaskStore;
  adapter: TrackerAdapter;
  mapping?: SyncMapping;
  direction?: 'pull' | 'push' | 'both';
  dryRun?: boolean;
}

const SYSTEM = new Set(['youtrack', 'jira', 'linear', 'file']);

function canonicalFields(task: Task): Record<string, unknown> {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    tags: [...(task.tags ?? [])].sort(),
    assignee: task.assignee ?? '',
  };
}

export function localFingerprint(task: Task): string {
  return createHash('sha256').update(JSON.stringify(canonicalFields(task))).digest('hex');
}

function externalFields(ext: ExternalTask, mapping: SyncMapping): Record<string, unknown> {
  return {
    title: ext.title,
    description: ext.description ?? '',
    status: externalToLocal(mapping, 'status', ext.status) ?? ext.status,
    priority: externalToLocal(mapping, 'priority', ext.priority) ?? ext.priority ?? 'medium',
    tags: [...(ext.tags ?? [])].sort(),
    assignee: ext.assignee ?? '',
  };
}

function localFields(task: Task, mapping: SyncMapping): Record<string, unknown> {
  return {
    title: task.title,
    description: task.description ?? '',
    status: localToExternal(mapping, 'status', task.status),
    priority: localToExternal(mapping, 'priority', task.priority),
    tags: [...(task.tags ?? [])].sort(),
    assignee: task.assignee ?? '',
  };
}

function diffFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

function taskPatchFromExternal(ext: ExternalTask, mapping: SyncMapping): Partial<Task> {
  return {
    title: ext.title,
    description: ext.description,
    status: (externalToLocal(mapping, 'status', ext.status) ?? ext.status) as Task['status'],
    priority: localPriority(externalToLocal(mapping, 'priority', ext.priority)) ?? 'medium',
    tags: ext.tags,
    assignee: ext.assignee,
  };
}

export async function syncTasks(options: SyncOptions): Promise<SyncResult> {
  const mapping = validateMapping(options.mapping ?? DEFAULT_MAPPING);
  const direction = options.direction ?? 'both';
  const dryRun = options.dryRun ?? true;
  const system = options.adapter.system;
  if (!SYSTEM.has(system)) throw new Error(`unsupported tracker system: ${system}`);

  const result: SyncResult = {
    dryRun,
    createdLocal: [], updatedLocal: [], createdExternal: [], updatedExternal: [], skipped: [], conflicts: [], errors: [],
  };
  const local = await options.store.list(options.project);
  const localByExternal = new Map<string, Task>();
  for (const task of local) {
    if (task.external?.system === system) localByExternal.set(task.external.id, task);
  }
  const seenExternal = new Set<string>();

  const linkPatch = (task: Task, ext: ExternalTask): Partial<Task> => ({
    external: {
      system: system as NonNullable<Task['external']>['system'],
      id: ext.id,
      url: ext.url,
      updatedAt: ext.updatedAt,
      localHash: localFingerprint(task),
    },
  });

  if (direction === 'pull' || direction === 'both') {
    const external = await options.adapter.list(options.project);
    for (const ext of external) {
      seenExternal.add(ext.id);
      const linked = localByExternal.get(ext.id);
      if (!linked) {
        if (dryRun) { result.createdLocal.push(ext.id); continue; }
        const created = await options.store.create({
          project: options.project,
          title: ext.title,
          description: ext.description,
          status: (externalToLocal(mapping, 'status', ext.status) ?? ext.status) as Task['status'],
          priority: localPriority(externalToLocal(mapping, 'priority', ext.priority)) ?? 'medium',
          tags: ext.tags,
          assignee: ext.assignee,
          external: {
            system: system as NonNullable<Task['external']>['system'],
            id: ext.id,
            url: ext.url,
            updatedAt: ext.updatedAt,
            localHash: '',
          },
        });
        const linkedTask = await options.store.update(options.project, created.id, linkPatch(created, ext));
        if (linkedTask) result.createdLocal.push(linkedTask.id);
        continue;
      }

      const localChanged = linked.external?.localHash !== localFingerprint(linked);
      const externalChanged = linked.external?.updatedAt !== ext.updatedAt;
      if (!localChanged && !externalChanged) { result.skipped.push(linked.id); continue; }

      if (externalChanged && !localChanged) {
        if (dryRun) { result.updatedLocal.push(linked.id); continue; }
        const patched = await options.store.update(options.project, linked.id, taskPatchFromExternal(ext, mapping));
        if (!patched) { result.errors.push({ taskId: linked.id, externalId: ext.id, message: 'local update returned null' }); continue; }
        await options.store.update(options.project, linked.id, linkPatch(patched, ext));
        result.updatedLocal.push(linked.id);
        continue;
      }

      // Both sides changed (or only local): newer side wins; equal timestamps and
      // different mapped fields are a conflict.
      const localFieldsForDiff = canonicalFields(linked);
      const externalFieldsForDiff = externalFields(ext, mapping);
      const changedFields = diffFields(localFieldsForDiff, externalFieldsForDiff);
      if (!localChanged && changedFields.length === 0) { result.skipped.push(linked.id); continue; }
      if (externalChanged && localChanged) {
        if (ext.updatedAt > linked.updatedAt) {
          if (dryRun) { result.updatedLocal.push(linked.id); continue; }
          const patched = await options.store.update(options.project, linked.id, taskPatchFromExternal(ext, mapping));
          if (patched) await options.store.update(options.project, linked.id, linkPatch(patched, ext));
          result.updatedLocal.push(linked.id);
        } else if (linked.updatedAt > ext.updatedAt) {
          if (dryRun) { result.updatedExternal.push(linked.id); continue; }
          const pushed = await options.adapter.update(ext.id, localFields(linked, mapping) as Partial<ExternalTask>);
          const linkedTask = await options.store.update(options.project, linked.id, linkPatch(linked, pushed));
          if (linkedTask) result.updatedExternal.push(linked.id);
        } else {
          result.conflicts.push({ taskId: linked.id, externalId: ext.id, fields: changedFields });
        }
        continue;
      }
      // only local changed: push
      if (dryRun) { result.updatedExternal.push(linked.id); continue; }
      const pushed = await options.adapter.update(ext.id, localFields(linked, mapping) as Partial<ExternalTask>);
      await options.store.update(options.project, linked.id, linkPatch(linked, pushed));
      result.updatedExternal.push(linked.id);
    }
  }

  if (direction === 'push' || direction === 'both') {
    for (const task of local) {
      if (task.external?.system === system) continue;
      if (dryRun) { result.createdExternal.push(task.id); continue; }
      const created = await options.adapter.create({
        id: '',
        title: task.title,
        description: task.description,
        status: localToExternal(mapping, 'status', task.status),
        priority: localToExternal(mapping, 'priority', task.priority),
        tags: task.tags,
        assignee: task.assignee,
        updatedAt: new Date().toISOString(),
      });
      const linkedTask = await options.store.update(options.project, task.id, linkPatch(task, created));
      if (linkedTask) result.createdExternal.push(linkedTask.id);
    }
  }

  return result;
}
