import type { ServerContext } from './context.js';
import { getPackageVersion } from '../utils/package-version.js';
import { ok } from '../utils/respond.js';
import {
  isCatalogEnabled,
  isCatalogReadEnabled,
  isCatalogWriteEnabled,
  isPromptsBuildEnabled,
  isToolResourcesEnabled,
  isToolResourcesExecEnabled,
  isToolsEnabled,
  resolveStorageIndexMode,
} from '../config.js';
import { MAX_LIMIT } from '../utils/pagination.js';

/** DX-15: static limits an agent can rely on without probing each tool. */
const LIMITS = {
  maxPageLimit: MAX_LIMIT,
  toolsListMax: 300,
  agentBootstrapTextMaxChars: 4096,
} as const;

function gitHistoryEnabled(): boolean {
  return process.env.HISTORY_ENABLED === '1' && process.env.NODE_ENV !== 'test';
}

export function registerServerCapabilitiesTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'server_capabilities',
    {
      title: 'Server Capabilities',
      description:
        'Return the server version, MCP capability flags, enabled/disabled feature domains and ' +
        'static limits. Read-only; use before calling a feature tool that may be disabled by env.',
      inputSchema: {},
    },
    async () => {
      const version = await getPackageVersion();
      return ok({
        server: {
          name: 'mcp-task-knowledge',
          version,
          toolCount: ctx.toolRegistry.size,
          registryVersion: ctx.toolRegistry.version,
        },
        capabilities: ctx.SERVER_CAPS,
        features: [
          { id: 'tools', enabled: isToolsEnabled() },
          {
            id: 'tool_resources',
            enabled: isToolResourcesEnabled(),
            execEnabled: isToolResourcesExecEnabled(),
          },
          {
            id: 'catalog',
            enabled: isCatalogEnabled(),
            readEnabled: isCatalogReadEnabled(),
            writeEnabled: isCatalogWriteEnabled(),
          },
          { id: 'prompts_build', enabled: isPromptsBuildEnabled() },
          { id: 'git_history', enabled: gitHistoryEnabled() },
          { id: 'storage_index', enabled: resolveStorageIndexMode() !== 'off', mode: resolveStorageIndexMode() },
        ],
        limits: LIMITS,
        errorEnvelope: { ok: '{ok:true,data}', error: '{ok:false,error:{message,code?,hint?}}' },
      });
    },
  );
}
