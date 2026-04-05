import { z } from "zod";
import type { ServerContext } from './context.js';
import { getCurrentProject } from '../config.js';
import { ok, err } from '../utils/respond.js';

export function registerToolsIntrospection(ctx: ServerContext): void {
  function buildExampleFor(name: string, meta: { inputSchema?: Record<string, any> } | undefined) {
    const ex: Record<string, any> = {};
    const keys = meta?.inputSchema ? Object.keys(meta.inputSchema) : [];
    for (const k of keys) {
      const key = String(k);
      if (key === 'project') ex[key] = getCurrentProject();
      else if (key === 'id') ex[key] = '00000000-0000-0000-0000-000000000000';
      else if (key === 'ids') ex[key] = ['00000000-0000-0000-0000-000000000000'];
      else if (key === 'title') ex[key] = 'Example Title';
      else if (key === 'description') ex[key] = 'Example Description';
      else if (key === 'content') ex[key] = 'Example Content';
      else if (key === 'tags') ex[key] = ['example'];
      else if (key === 'links') ex[key] = ['https://example.com'];
      else if (key === 'parentId') ex[key] = null;
      else if (key === 'status') ex[key] = 'pending';
      else if (key === 'priority') ex[key] = 'medium';
      else if (key === 'confirm') ex[key] = true;
      else if (key === 'dryRun') ex[key] = false;
      else if (key === 'knowledge' || key === 'tasks' || key === 'overwriteByTitle') ex[key] = true;
      else if (key === 'prompts') ex[key] = true;
      else if (key === 'includePromptSourcesJson') ex[key] = true;
      else if (key === 'includePromptSourcesMd') ex[key] = true;
      else if (key === 'importPromptSourcesJson') ex[key] = true;
      else if (key === 'importPromptMarkdown') ex[key] = true;
      else if (key === 'keepOrphans') ex[key] = false;
      else if (key === 'strategy') ex[key] = 'merge';
      else if (key === 'mergeStrategy') ex[key] = 'overwrite';
      else if (key === 'query') ex[key] = 'example';
      else if (key === 'texts') ex[key] = ['text'];
      else if (key === 'limit') ex[key] = 10;
      else if (key === 'prefilterLimit') ex[key] = 20;
      else if (key === 'chunkSize') ex[key] = 1000;
      else if (key === 'chunkOverlap') ex[key] = 200;
      else if (key === 'tag') ex[key] = 'example';
      else if (key === 'includeArchived') ex[key] = false;
      else if (key === 'updatedFrom') ex[key] = '2025-01-01T00:00:00Z';
      else if (key === 'updatedTo') ex[key] = '2025-12-31T23:59:59Z';
      else if (key === 'type') ex[key] = 'note';
      else if (key === 'includePaths' || key === 'excludePaths') ex[key] = ['Knowledge/**/*.md', 'Tasks/**/*.md'];
      else if (key === 'includeTags' || key === 'excludeTags') ex[key] = ['tag1', 'tag2'];
      else if (key === 'includeTypes') ex[key] = ['note', 'spec'];
      else if (key === 'includeStatus') ex[key] = ['pending', 'in_progress'];
      else if (key === 'includePriority') ex[key] = ['high', 'medium'];
      else ex[key] = 'example';
    }
    return ex;
  }

  ctx.server.registerTool(
    "tools_list",
    {
      title: "List Registered Tools",
      description: "Return list of canonical tool names with metadata (title, description, input keys)",
      inputSchema: {},
    },
    async () => ok(Array.from(ctx.toolRegistry.entries()).map(([name, meta]) => ({
      name,
      title: meta?.title ?? null,
      description: meta?.description ?? null,
      inputKeys: meta?.inputSchema ? Object.keys(meta.inputSchema) : [],
    })))
  );

  ctx.server.registerTool(
    "tool_schema",
    {
      title: "Tool Schema",
      description: "Return metadata and example payload for a tool name",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }: { name: string }) => {
      const meta = ctx.toolRegistry.get(name);
      if (!meta) return err(`Tool not found: ${name}`);
      const example = buildExampleFor(name, meta);
      const payload = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        inputKeys: meta.inputSchema ? Object.keys(meta.inputSchema) : [],
        example,
      };
      return ok(payload);
    }
  );

  ctx.server.registerTool(
    "tool_help",
    {
      title: "Tool Help",
      description: "Short help for a tool with an example call",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }: { name: string }) => {
      const meta = ctx.toolRegistry.get(name);
      if (!meta) return err(`Tool not found: ${name}`);
      const example = buildExampleFor(name, meta);
      const help = {
        name,
        title: meta.title ?? null,
        description: meta.description ?? null,
        exampleCall: { name, params: example },
      };
      return ok(help);
    }
  );

  ctx.server.registerTool(
    "tools_run",
    {
      title: "Tools Run (Bulk)",
      description: "Execute one or many tools by name with params via RPC.",
      inputSchema: {
        name: z.string().optional(),
        params: z.any().optional(),
        items: z.array(z.object({ name: z.string(), params: z.any().optional() })).optional(),
        stopOnError: z.boolean().optional(),
      },
    },
    async ({ name, params, items, stopOnError }: { name?: string; params?: any; items?: Array<{ name: string; params?: any }>; stopOnError?: boolean }) => {
      const runs: Array<{ name: string; params?: any }> = [];
      if (Array.isArray(items) && items.length > 0) runs.push(...items.map((i) => ({ name: i.name, params: i.params })));
      if (name) runs.push({ name, params });
      if (runs.length === 0) return err('no tool specified');

      const results: any[] = [];
      for (const r of runs) {
        const meta = ctx.toolRegistry.get(r.name);
        if (!meta || typeof meta.handler !== 'function') {
          const e = { name: r.name, ok: false, error: `Tool not found or not executable: ${r.name}` };
          results.push(e);
          if (stopOnError) break;
          continue;
        }
        try {
          const res = await meta.handler(r.params ?? {});
          let payload: any = res;
          try {
            const maybe = (res as any)?.content?.[0]?.text;
            if (typeof maybe === 'string' && maybe.trim().length > 0) payload = JSON.parse(maybe);
          } catch {}
          let okFlag = true;
          let dataOut: any = payload;
          let errOut: any = undefined;
          if (payload && typeof payload === 'object') {
            if (typeof (payload as any).ok === 'boolean') okFlag = (payload as any).ok === true;
            if (Object.prototype.hasOwnProperty.call(payload, 'data')) dataOut = (payload as any).data;
            if ((payload as any).isError === true) okFlag = false;
            if (!okFlag && Object.prototype.hasOwnProperty.call(payload as any, 'error')) {
              const e = (payload as any).error;
              errOut = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : e;
            }
          }
          results.push({ name: r.name, ok: okFlag, data: okFlag ? dataOut : undefined, error: okFlag ? undefined : (errOut ?? 'error') });
        } catch (e: any) {
          results.push({ name: r.name, ok: false, error: e?.message || String(e) });
          if (stopOnError) break;
        }
      }
      return ok({ count: results.length, results });
    }
  );
}
