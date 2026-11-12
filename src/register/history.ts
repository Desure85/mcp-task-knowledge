/** MU-04: history/diff/restore over the git history repo. */
import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { history, historyEnabled } from '../history/service.js';
import { ok, err } from '../utils/respond.js';

type Entity = 'tasks' | 'knowledge' | 'skills';

function globs(entity: Entity, project: string, id: string): string[] {
  if (entity === 'tasks') return [`tasks/${project}/${id}.json`, `tasks/${project}/**/${id}.json`];
  if (entity === 'knowledge') return [`knowledge/${project}/${id}.md`, `knowledge/${project}/**/${id}.md`];
  return [`prompts/${project}/${id}@*.json`, `prompts/${project}/**/${id}@*.json`];
}

function title(entity: Entity): string {
  return entity === 'tasks' ? 'Task' : entity === 'knowledge' ? 'Document' : 'Skill';
}

async function findPaths(entity: Entity, project: string, id: string): Promise<string[]> {
  await history().flush();
  const found: string[] = [];
  for (const glob of globs(entity, project, id)) {
    found.push(...(await history().tracked([`:(glob)${glob}`])));
  }
  return [...new Set(found)];
}

function registerEntity(ctx: ServerContext, entity: Entity): void {
  const base = entity === 'skills' ? 'skills' : entity;
  const label = title(entity);

  ctx.server.registerTool(
    `${base}_history`,
    {
      title: `${label} History`,
      description: `List git commits that touched a ${label.toLowerCase()} in DATA_DIR.`,
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(20).optional(),
      },
    },
    async ({ project, id, limit }: { project?: string; id: string; limit?: number }) => {
      if (!historyEnabled()) return err('Git history is disabled (set HISTORY_ENABLED=1)');
      const prj = resolveProject(project);
      const paths = await findPaths(entity, prj, id);
      if (paths.length === 0) return err(`${label} not found in history: ${prj}/${id}`);
      return ok({ project: prj, id, paths, commits: await history().logPaths(paths, limit ?? 20) });
    },
  );

  ctx.server.registerTool(
    `${base}_diff`,
    {
      title: `${label} Diff`,
      description: `Show the diff of one commit for a ${label.toLowerCase()}.`,
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
        commit: z.string().min(4),
      },
    },
    async ({ project, id, commit }: { project?: string; id: string; commit: string }) => {
      if (!historyEnabled()) return err('Git history is disabled (set HISTORY_ENABLED=1)');
      const prj = resolveProject(project);
      const paths = await findPaths(entity, prj, id);
      if (paths.length === 0) return err(`${label} not found in history: ${prj}/${id}`);
      return ok({ project: prj, id, commit, diff: await history().diffCommit(commit, paths) });
    },
  );

  ctx.server.registerTool(
    `${base}_version_restore`,
    {
      title: `${label} Restore`,
      description: `Restore a ${label.toLowerCase()} from a commit as a new commit (history is not erased).`,
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
        commit: z.string().min(4),
      },
    },
    async ({ project, id, commit }: { project?: string; id: string; commit: string }) => {
      if (!historyEnabled()) return err('Git history is disabled (set HISTORY_ENABLED=1)');
      const prj = resolveProject(project);
      const paths = await findPaths(entity, prj, id);
      if (paths.length === 0) return err(`${label} not found in history: ${prj}/${id}`);
      for (const file of paths) await history().restoreFile(commit, file);
      return ok({ project: prj, id, restoredFrom: commit, files: paths });
    },
  );
}

export function registerHistoryTools(ctx: ServerContext): void {
  registerEntity(ctx, 'tasks');
  registerEntity(ctx, 'knowledge');
  registerEntity(ctx, 'skills');
}

