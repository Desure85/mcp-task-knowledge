import { z } from "zod";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject, getCurrentProject, setCurrentProject } from '../config.js';
import { listProjects, getProjectDetail, createProject, deleteProject, updateProjectMeta } from '../projects.js';
import { ok, err } from '../utils/respond.js';

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
      const out = await listProjects(getCurrentProject);
      return ok(out);
    }
  );

  // project_get_current — get the active project
  ctx.server.registerTool(
    "project_get_current",
    {
      title: "Get Current Project",
      description: "Return the name of the current project context",
      inputSchema: {},
    },
    async () => ok({ project: getCurrentProject() })
  );

  // project_set_current — switch project
  ctx.server.registerTool(
    "project_set_current",
    {
      title: "Set Current Project",
      description: "Change the current project context used when project is omitted",
      inputSchema: {
        project: z.string().min(1),
      },
    },
    async ({ project }: { project: string }) => ok({ project: setCurrentProject(project) })
  );

  // project_create — create a new project
  ctx.server.registerTool(
    "project_create",
    {
      title: "Create Project",
      description: "Create a new project with optional description. Creates task and knowledge directories automatically.",
      inputSchema: {
        id: z.string().min(1).describe('Project identifier (lowercase, alphanumeric, hyphens)'),
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
