import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { storageProfile } from '../core/storage-context.js';
import { resolveProject } from '../config.js';
import { ok, okWith, err, errWith } from '../utils/respond.js';
import { PaginationError, paginateKeyed } from '../utils/pagination.js';
import { pageArgsSchema, pageFromStorage, toPageRequest } from './page-args.js';

/** Y-02e2: documents come from the context profile, not from a module import. */
function docStore(ctx: ServerContext) {
  return storageProfile(ctx).docs;
}

export function registerKnowledgeTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "knowledge_list",
    {
      title: "List Knowledge Docs",
      description:
        "List knowledge document metadata with cursor pagination and field selection. " +
        "Returns `data` (array) plus total/count/hasMore/nextCursor/truncated/limit.",
      inputSchema: {
        project: z.string().optional(),
        tag: z.string().optional(),
        type: z.string().optional().describe("Document type (component, api, adr, ...)"),
        parentId: z.string().optional().describe("Only direct children of this document"),
        rootsOnly: z.boolean().optional().describe('Only documents without a parent (tree roots)'),
        includeArchived: z.boolean().default(false).optional(),
        ...pageArgsSchema,
      },
    },
    async ({ project, tag, type, parentId, rootsOnly, includeArchived, ...pageArgs }) => {
      const prj = resolveProject(project);
      try {
        const request = toPageRequest(pageArgs);
        const page = await docStore(ctx).page(prj, {
          limit: request.limit ?? 50,
          cursor: request.cursor,
          tag,
          type,
          parentId,
          rootsOnly,
          includeArchived,
          countOnly: request.countOnly,
        });
        const result = pageFromStorage(page, request, (m) => m.id);
        return okWith(result.items, result.meta);
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        throw e;
      }
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
        ...pageArgsSchema,
      },
    },
    async ({ project, includeArchived, ...pageArgs }) => {
      const prj = resolveProject(project);
      try {
        const request = toPageRequest(pageArgs);
        const metas = await docStore(ctx).list({ project: prj });
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
        const result = paginateKeyed(roots, request, (n) => n.updatedAt || '', (n) => n.id);
        return okWith(result.items, result.meta);
      } catch (e) {
        if (e instanceof PaginationError) return errWith({ message: e.message, code: e.code, hint: e.hint });
        throw e;
      }
    }
  );

  ctx.server.registerTool(
    "knowledge_get",
    {
      title: "Get Knowledge Doc",
      description: "Read a knowledge document by id",
      inputSchema: {
        project: z.string().optional(),
        id: z.string().min(1),
      },
    },
    async ({ project, id }) => {
      const prj = resolveProject(project);
      const d = await docStore(ctx).read(prj, id);
      if (!d) {
        return err(`Doc not found: ${project}/${id}`);
      }
      return ok(d);
    }
  );
}
