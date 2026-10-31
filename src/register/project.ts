import { z } from "zod";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject, getCurrentProject, setCurrentProject } from '../config.js';
import { listProjects, getProjectDetail, createProject, deleteProject, updateProjectMeta, PROJECT_ID_RE } from '../projects.js';
import { ok, err, errWith } from '../utils/respond.js';
import { currentSessionId } from '../core/request-context.js';
import { scheduleProjectIndex } from '../search/warmup.js';
import { STATUS_ID_RE, WorkflowError } from '../workflow.js';
import { getProjectStatuses, getProjectTransitions, setProjectStatuses, setProjectTransitions } from '../workflow-service.js';

// PH-004: per-session current project. When the caller has a live session
// (http/tcp), project_set_current writes into session metadata instead of the
// shared global — concurrent clients keep isolated contexts. stdio / no
// session → global setCurrentProject (persisted, backward compatible).
function sessionCurrentProject(ctx: ServerContext): string | undefined {
  const sid = currentSessionId();
  if (!sid || !ctx.sessionManager?.has(sid)) return undefined;
  const cur = ctx.sessionManager.get(sid)?.metadata?.['currentProject'];
  return typeof cur === 'string' && cur.trim().length > 0 ? cur : undefined;
}

export function registerProjectTools(ctx: ServerContext): void {
  // project_list — list all projects with task/knowledge counts
  ctx.server.registerTool(
    "project_list",
    {
      title: "Project List",
      description: "List all available projects with task and knowledge counts, descriptions, and creation dates.",
      inputSchema: {},
    },
    async () => {
      const out = await listProjects(() => sessionCurrentProject(ctx) ?? getCurrentProject());
      return ok(out);
    }
  );

  // project_get_current — get the active project
  ctx.server.registerTool(
    "project_get_current",
    {
      title: "Get Current Project",
      description: "Return the name of the current project context (session-scoped on multi-client transports)",
      inputSchema: {},
    },
    async () => {
      const scoped = sessionCurrentProject(ctx);
      return ok({ project: scoped ?? getCurrentProject(), scope: scoped ? 'session' : 'global' });
    }
  );

  // project_set_current — switch project
  ctx.server.registerTool(
    "project_set_current",
    {
      title: "Set Current Project",
      description: "Change the current project context used when project is omitted (per-session on http/tcp, global on stdio)",
      inputSchema: {
        project: z.string().min(1),
      },
    },
    async ({ project }: { project: string }) => {
      const sid = currentSessionId();
      scheduleProjectIndex(project);
      if (sid && ctx.sessionManager?.has(sid)) {
        ctx.sessionManager.updateMetadata(sid, { currentProject: project });
        return ok({ project, scope: 'session' });
      }
      return ok({ project: setCurrentProject(project), scope: 'global' });
    }
  );

  // project_create — create a new project
  ctx.server.registerTool(
    "project_create",
    {
      title: "Create Project",
      description: "Create a new project with optional description. Creates task and knowledge directories automatically.",
      inputSchema: {
        id: z.string().min(1).regex(PROJECT_ID_RE, 'id must start with a letter/digit and contain only [a-zA-Z0-9_-]').describe('Project identifier (lowercase, alphanumeric, hyphens)'),
        description: z.string().optional().describe('Project description'),
      },
    },
    async ({ id, description }) => {
      // Validate project ID
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        return err('Project ID must be lowercase alphanumeric (can include hyphens, dots, underscores), must start with letter or digit');
      }

      // Check for existing project with same ID
      const existing = await listProjects(getCurrentProject);
      if (existing.projects.some(p => p.id === id)) {
        return err(`Project '${id}' already exists`);
      }

      const project = await createProject(id, description);
      return ok({
        project: project.id,
        message: `Project '${id}' created`,
        paths: project.paths,
      });
    }
  );

  // project_info — detailed project info with stats
  ctx.server.registerTool(
    "project_info",
    {
      title: "Project Info",
      description: "Get detailed information about a project: task stats by status/priority, knowledge stats by type, recent activity, and metadata.",
      inputSchema: {
        project: z.string().optional().describe('Project ID (defaults to current)'),
      },
    },
    async ({ project }) => {
      const prj = resolveProject(project);
      const detail = await getProjectDetail(prj, getCurrentProject);

      if (!detail) {
        return err(`Project not found: ${prj}`);
      }

      return ok(detail);
    }
  );

  // project_delete — delete a project
  ctx.server.registerTool(
    "project_delete",
    {
      title: "Delete Project",
      description: "Delete a project and all its data. Requires force=true if project has tasks or knowledge entries.",
      inputSchema: {
        project: z.string().describe('Project ID to delete'),
        force: z.boolean().default(false).describe('Force deletion even if project has data'),
      },
    },
    async ({ project, force }) => {
      const result = await deleteProject(project, force || false);

      if (!result.deleted) {
        return err(result.message);
      }

      // If the deleted project was current, switch to default
      if (project === getCurrentProject()) {
        const { DEFAULT_PROJECT } = await import('../config.js');
        setCurrentProject(DEFAULT_PROJECT);
        return ok({
          ...result,
          switchedToDefault: true,
          currentProject: DEFAULT_PROJECT,
        });
      }

      return ok(result);
    }
  );

  // project_update — update project metadata
  ctx.server.registerTool(
    "project_update",
    {
      title: "Update Project",
      description: "Update project metadata (description).",
      inputSchema: {
        project: z.string().optional().describe('Project ID (defaults to current)'),
        description: z.string().optional().describe('New project description'),
      },
    },
    async ({ project, description }) => {
      if (!description) {
        return err('At least one field to update is required (e.g., description)');
      }

      const prj = resolveProject(project);
      const meta = await updateProjectMeta(prj, { description });

      if (!meta) {
        return err(`Project not found: ${prj}`);
      }

      return ok({
        project: prj,
        metadata: meta,
        message: `Project '${prj}' updated`,
      });
    }
  );

  // project_statuses_get — statuses, close target and initial statuses
  ctx.server.registerTool(
    "project_statuses_get",
    {
      title: "Get Project Statuses",
      description: "Get the project status set, close status and allowed initial statuses. New projects use the default four statuses.",
      inputSchema: {
        project: z.string().optional().describe('Project ID (defaults to current)'),
      },
    },
    async ({ project }) => {
      const prj = resolveProject(project);
      return ok(await getProjectStatuses(prj));
    }
  );

  // project_statuses_set — replace the status set, optionally moving used statuses
  ctx.server.registerTool(
    "project_statuses_set",
    {
      title: "Set Project Statuses",
      description:
        "Replace the project status set. Statuses used by tasks cannot be removed without moveTo or moves. " +
        "At least one active todo and one active done status are required.",
      inputSchema: {
        project: z.string().optional().describe('Project ID (defaults to current)'),
        statuses: z.array(z.object({
          id: z.string().regex(STATUS_ID_RE, 'status id must be a lowercase slug'),
          label: z.string().min(1),
          category: z.enum(['todo', 'in_progress', 'done']),
          color: z.string().min(1).max(64).optional(),
          order: z.number().int().min(0).optional(),
          archived: z.boolean().optional(),
        })).min(1),
        moveTo: z.string().optional().describe('Move tasks from every removed status to this status'),
        moves: z.record(z.string()).optional().describe('Per-status move targets, e.g. {"old":"new"}'),
        closeStatus: z.string().optional().describe('Target status for tasks_close; must be a done status'),
        initialStatuses: z.array(z.string()).optional().describe('Statuses allowed for tasks_create; default all todo statuses'),
      },
    },
    async ({ project, ...input }) => {
      const prj = resolveProject(project);
      try {
        return ok(await setProjectStatuses(prj, input));
      } catch (e) {
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        throw e;
      }
    }
  );

  // project_transitions_get — allowed status transitions
  ctx.server.registerTool(
    "project_transitions_get",
    {
      title: "Get Project Transitions",
      description: "Get the allowed status transition graph. A null graph means every transition is allowed.",
      inputSchema: {
        project: z.string().optional().describe('Project ID (defaults to current)'),
      },
    },
    async ({ project }) => {
      const prj = resolveProject(project);
      return ok(await getProjectTransitions(prj));
    }
  );

  // project_transitions_set — replace the transition graph
  ctx.server.registerTool(
    "project_transitions_set",
    {
      title: "Set Project Transitions",
      description:
        "Replace the allowed status transition graph. A missing from-key is unrestricted; use null to restore any-to-any. " +
        "The graph must not leave a done status unreachable from the initial statuses.",
      inputSchema: {
        project: z.string().optional().describe('Project ID (defaults to current)'),
        transitions: z.record(z.array(z.string())).nullable(),
      },
    },
    async ({ project, transitions }) => {
      const prj = resolveProject(project);
      try {
        return ok(await setProjectTransitions(prj, transitions));
      } catch (e) {
        if (e instanceof WorkflowError) return errWith(e.toPayload());
        throw e;
      }
    }
  );

  // embeddings_try_init — keep existing
  ctx.server.registerTool(
    "embeddings_try_init",
    {
      title: "Embeddings Try Init",
      description: "Force lazy initialization of vector adapter and return diagnostics",
      inputSchema: {},
    },
    async () => {
      const startedAt = Date.now();
      const c = loadConfig();
      const result: Record<string, unknown> = { mode: c.embeddings.mode, startedAt };
      try {
        const va = await ctx.ensureVectorAdapter();
        result.elapsedMs = Date.now() - startedAt;
        result.initialized = Boolean(va);
        if (va && typeof (va as unknown as Record<string, unknown>).info === 'function') {
          try { result.adapterInfo = await ((va as unknown as Record<string, () => Promise<unknown>>).info)(); } catch {}
        }
        if (!va) {
          result.message = 'vector adapter not available after init attempt';
        }
      } catch (e: unknown) {
        result.elapsedMs = Date.now() - startedAt;
        result.initialized = false;
        result.error = e instanceof Error ? e.message : String(e);
      }
      return ok(result);
    }
  );
}
