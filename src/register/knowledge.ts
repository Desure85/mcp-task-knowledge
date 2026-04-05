import { z } from "zod";
import type { ServerContext } from './context.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { ok, err } from '../utils/respond.js';

export function registerKnowledgeTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "knowledge_list",
    {
      title: "List Knowledge Docs",
      description: "List knowledge documents metadata",
      inputSchema: {
        project: z.string().optional(),
        tag: z.string().optional(),
      },
    },
    async ({ project, tag }) => {
      const prj = resolveProject(project);
      const items = await listDocs({ project: prj, tag });
      return ok(items);
    }
  );

  ctx.server.registerTool(
    "knowledge_tree",
    {
      title: "Knowledge Tree",
      description: "List knowledge documents as a hierarchical tree (by parentId)",
      inputSchema: {
        project: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
      },
    },
    async ({ project, includeArchived }) => {
      const prj = resolveProject(project);
      const metas = await listDocs({ project: prj });
      const filtered = metas.filter((m) => !m.trashed && (includeArchived ? true : !m.archived));
      const byId = new Map(filtered.map((m) => [m.id, { ...m, children: [] as any[] }]));
      const roots: any[] = [];
      for (const m of byId.values()) {
        if (m.parentId && byId.has(m.parentId)) {
          byId.get(m.parentId)!.children.push(m);
        } else {
          roots.push(m);
        }
      }
      return ok(roots);
    }
  );

  ctx.server.registerTool(
    "knowledge_get",
    {
      title: "Get Knowledge Doc",
      description: "Read a knowledge document by id",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1),
      },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const d = await readDoc(prj, id);
      if (!d) {
        return err(`Doc not found: ${project}/${id}`);
      }
      return ok(d);
    }
  );
}
