import { z } from "zod/v3";
import type { ServerContext } from './context.js';
import { resolveProject } from '../config.js';
import { getPackageVersion } from '../utils/package-version.js';
import { ok } from '../utils/respond.js';

/**
 * DX-12: `agent_bootstrap` — one-call self-integration contract.
 *
 * Returns instructions and a capability manifest, not task data. `briefing`
 * remains the data snapshot; this tool tells an agent *how* to use the server.
 */
const RECOMMENDED = [
  'briefing',
  'tasks_list',
  'tasks_get',
  'tasks_create',
  'tasks_update',
  'tasks_close',
  'knowledge_search',
  'knowledge_get',
  'memory_facts_search',
  'memory_temporal_query',
];

export function registerBootstrapTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'agent_bootstrap',
    {
      title: 'Agent Bootstrap',
      description:
        'Return a compact self-integration block for an agent: how to call tools, ' +
        'project convention, ok/error envelope, capability flags and recommended tools. ' +
        'Read-only; does not return task or document content.',
      inputSchema: {
        project: z.string().optional().describe('Project key to report; defaults to current project'),
      },
    },
    async ({ project }: { project?: string }) => {
      const prj = resolveProject(project);
      const version = await getPackageVersion();
      const names = new Set(ctx.toolRegistry.names());
      const recommended = RECOMMENDED.filter((name) => names.has(name));
      const disabled = RECOMMENDED.filter((name) => !names.has(name));

      const text = [
        '# mcp-task-knowledge — agent bootstrap',
        '',
        `Server: mcp-task-knowledge ${version}; project: ${prj}; tools: ${ctx.toolRegistry.size}.`,
        '',
        '1. Always pass `project` (or rely on CURRENT_PROJECT) on project-scoped tools.',
        '2. Success is `{ok:true,data}`; failure is `{ok:false,error:{message,code?,hint?}}`.',
        '   Check `ok` before reading `data`; do not retry a non-retryable error blindly.',
        '3. Start a session with `briefing`; use `tools_list`/`tool_schema` before an unknown tool.',
        '4. Writes: pass `expectedVersion` when updating an entity you read earlier (CAS).',
        '5. Destructive actions require explicit confirmation/`confirm`; never invent one.',
        '6. This server does not sample or elicit; all input is explicit tool arguments.',
        '',
        `Recommended: ${recommended.join(', ') || '(none of the recommended tools are enabled)'}.`,
        disabled.length ? `Unavailable by profile/feature flag: ${disabled.join(', ')}.` : '',
      ].filter(Boolean).join('\n');

      return ok({
        server: {
          name: 'mcp-task-knowledge',
          version,
          toolCount: ctx.toolRegistry.size,
          registryVersion: ctx.toolRegistry.version,
          capabilities: ctx.SERVER_CAPS,
        },
        project: prj,
        instructions: { format: 'markdown' as const, text, maxChars: 4096 },
        tools: { total: ctx.toolRegistry.size, recommended, disabled },
        envelope: { ok: '{ok:true,data}', error: '{ok:false,error:{message,code?,hint?}}' },
      });
    },
  );
}
