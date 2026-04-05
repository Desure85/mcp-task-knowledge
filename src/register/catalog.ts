import type { ServerContext } from './context.js';
import { isCatalogEnabled, isCatalogReadEnabled, isCatalogWriteEnabled } from '../config.js';
import { z } from 'zod';
import { ok, err } from '../utils/respond.js';

export function registerCatalogTools(ctx: ServerContext) {
  if (isCatalogEnabled() && isCatalogReadEnabled()) {
    ctx.server.registerTool(
      "service_catalog_query",
      {
        title: "Service Catalog Query",
        description: "Query services from the service-catalog (supports filters, sort, pagination)",
        inputSchema: {
          search: z.string().optional(),
          component: z.string().optional(),
          owner: z.union([z.string(), z.array(z.string())]).optional(),
          tag: z.union([z.string(), z.array(z.string())]).optional(),
          domain: z.string().optional(),
          status: z.string().optional(),
          updatedFrom: z.string().optional(),
          updatedTo: z.string().optional(),
          sort: z.string().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
        },
      },
      async (params: any) => {
        try {
          const page = await ctx.catalogProvider.queryServices(params as any);
          return ok(page);
        } catch (e: any) {
          return err(`service-catalog query failed: ${e?.message || String(e)}`);
        }
      }
    );
  } else {
    console.warn('[startup][catalog] catalog read disabled — query tool will not be registered');
  }

  if (isCatalogEnabled() && isCatalogReadEnabled()) {
    ctx.server.registerTool(
      "service_catalog_health",
      {
        title: "Service Catalog Health",
        description: "Check health of the configured service-catalog source (remote/embedded)",
        inputSchema: {},
      },
      async () => {
        const h = await ctx.catalogProvider.health();
        return ok(h);
      }
    );
  }

  if (isCatalogEnabled() && isCatalogWriteEnabled()) {
    ctx.server.registerTool(
      "service_catalog_upsert",
      {
        title: "Service Catalog Upsert Services",
        description: "Create or update services in the service catalog (embedded or hybrid-embedded)",
        inputSchema: {
          items: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                component: z.string().min(1),
                domain: z.string().optional(),
                status: z.string().optional(),
                owners: z.array(z.string()).optional(),
                tags: z.array(z.string()).optional(),
                annotations: z.record(z.string()).optional(),
                updatedAt: z.string().optional(),
              })
            )
            .min(1)
            .max(100),
        },
      },
      async ({ items }: { items: Array<{ id: string; name: string; component: string; domain?: string; status?: string; owners?: string[]; tags?: string[]; annotations?: Record<string, string>; updatedAt?: string }> }) => {
        try {
          const res = await ctx.catalogProvider.upsertServices(items as any);
          return ok(res);
        } catch (e: any) {
          return err(`service-catalog upsert failed: ${e?.message || String(e)}`);
        }
      }
    );

    ctx.server.registerTool(
      "service_catalog_delete",
      {
        title: "Service Catalog Delete Services",
        description: "Delete services by ids from the service catalog (embedded or hybrid-embedded)",
        inputSchema: {
          ids: z.array(z.string().min(1)).min(1).max(200),
        },
      },
      async ({ ids }: { ids: string[] }) => {
        try {
          const res = await ctx.catalogProvider.deleteServices(ids);
          return ok(res);
        } catch (e: any) {
          return err(`service-catalog delete failed: ${e?.message || String(e)}`);
        }
      }
    );
  }
}