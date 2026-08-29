/**
 * register/config-tools.ts — Runtime config management tools (DX-004)
 * config_reload: hot-reload file config without restarting the server.
 */

import { z } from 'zod';
import type { ServerContext } from './context.js';
import { reloadFileConfig, loadConfig } from '../config.js';
import { ok } from '../utils/respond.js';

export function registerConfigTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'config_reload',
    {
      title: 'Reload Config',
      description:
        'Hot-reload the file config (--config or MCP_CONFIG_JSON) without restarting. ' +
        'Runtime-read settings (embeddings, catalog, prompts, currentProject) pick up ' +
        'new values; DATA_DIR-resolved paths require a restart.',
      inputSchema: {},
    },
    async () => {
      const result = reloadFileConfig();
      if (!result.ok) return ok({ reloaded: false, error: result.error });
      const cfg = loadConfig();
      return ok({
        reloaded: true,
        source: result.source,
        embeddingsMode: cfg.embeddings.mode,
        embeddingsDim: cfg.embeddings.dim ?? null,
      });
    },
  );
}
