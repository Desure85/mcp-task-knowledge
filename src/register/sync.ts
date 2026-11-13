/** INT-008: MCP surface for the mocked file tracker sync. */
import { join } from 'node:path';
import { z } from 'zod';
import { ok, errWith } from '../utils/respond.js';
import { storageProfile } from '../core/storage-context.js';
import { FileTrackerAdapter } from '../sync/file-tracker.js';
import { syncTasks } from '../sync/engine.js';
import type { ServerContext } from '../register/context.js';
import type { SyncTaskStore } from '../sync/types.js';
import type { Task } from '../types.js';

function taskStore(ctx: ServerContext) {
  const profile = storageProfile(ctx);
  if (!profile) throw new Error('storage profile is not configured');
  return profile.tasks;
}

function resolveProject(project: string | undefined): string {
  return project || process.env.CURRENT_PROJECT || 'mcp';
}

export function registerSyncTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'tasks_sync',
    {
      title: 'Sync Tasks With External Tracker',
      description: 'Two-way, idempotent sync with an external tracker. v1 uses a JSON file adapter (mock); dry-run by default.',
      inputSchema: {
        project: z.string().optional(),
        system: z.enum(['file', 'youtrack']).default('file'),
        direction: z.enum(['pull', 'push', 'both']).default('both'),
        dryRun: z.boolean().default(true),
        confirm: z.boolean().optional(),
      },
    },
    async ({ project, system, direction, dryRun, confirm }) => {
      if (system !== 'file') {
        return errWith({
          code: 'SYNC_NOT_CONFIGURED',
          message: 'youtrack sync needs a writable token and is not wired in this mock release',
          hint: 'use system=file for the local mock adapter',
        });
      }
      if (!dryRun && confirm !== true) {
        return errWith({ code: 'SYNC_CONFIRM_REQUIRED', message: 'dryRun=false requires confirm=true' });
      }
      const prj = resolveProject(project);
      const dataDir = process.env.DATA_DIR;
      if (!dataDir) return errWith({ code: 'SYNC_NOT_CONFIGURED', message: 'DATA_DIR is not configured' });
      const adapter = new FileTrackerAdapter(join(dataDir, 'sync', `${prj}.json`));
      const tasks = taskStore(ctx);
      const store: SyncTaskStore = {
        list: (p) => tasks.list({ project: p, includeArchived: true }),
        create: async (input) => {
          const created = await tasks.create({
            project: input.project,
            title: input.title,
            description: input.description,
            status: input.status as Task['status'],
            priority: input.priority,
            tags: input.tags,
          });
          return (await tasks.update(input.project, created.id, {
            assignee: input.assignee,
            external: input.external,
          })) ?? created;
        },
        update: (p, id, patch, expectedVersion) => tasks.update(p, id, patch, expectedVersion),
      };
      try {
        return ok(await syncTasks({ project: prj, store, adapter, direction, dryRun }));
      } catch (error) {
        return errWith({ code: 'SYNC_FAILED', message: (error as Error).message });
      }
    },
  );
}
