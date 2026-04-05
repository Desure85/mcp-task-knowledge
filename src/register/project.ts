import { z } from "zod";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject, getCurrentProject, setCurrentProject } from '../config.js';
import { listProjects } from '../projects.js';
import { ok, err } from '../utils/respond.js';

export function registerProjectTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "project_list",
    {
      title: "Project List",
      description: "List available projects by scanning disk under tasks/ and knowledge/",
      inputSchema: {},
    },
    async () => {
      const out = await listProjects(getCurrentProject);
      return ok(out);
    }
  );

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
      const result: any = { mode: c.embeddings.mode, startedAt };
      try {
        const va = await ctx.ensureVectorAdapter();
        result.elapsedMs = Date.now() - startedAt;
        result.initialized = Boolean(va);
        if (va && typeof va.info === 'function') {
          try { result.adapterInfo = await va.info(); } catch {}
        }
        if (!va) {
          result.message = 'vector adapter not available after init attempt';
        }
      } catch (e: any) {
        result.elapsedMs = Date.now() - startedAt;
        result.initialized = false;
        result.error = String(e?.message || e);
      }
      return ok(result);
    }
  );
}
