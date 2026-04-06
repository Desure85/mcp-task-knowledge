import { createServerContext } from './register/setup.js';
import { registerHelpers } from './register/helpers.js';
import { registerCatalogTools } from './register/catalog.js';
import { registerResources } from './register/resources.js';
import { registerPromptsTools } from './register/prompts.js';
import { registerObsidianTools } from './register/obsidian.js';
import { registerProjectTools } from './register/project.js';
import { registerBulkTools } from './register/bulk.js';
import { registerTasksTools } from './register/tasks.js';
import { registerKnowledgeTools } from './register/knowledge.js';
import { registerSearchTools } from './register/search.js';
import { registerProjectResources } from './register/project-resources.js';
import { registerSearchResources } from './register/search-resources.js';
import { registerAliases } from './register/aliases.js';
import { registerToolsIntrospection } from './register/tools-introspection.js';
import { registerDebugResources } from './register/debug-resources.js';
import { registerDependencyTools } from './register/dependencies.js';
import { registerDashboardTools } from './register/dashboard.js';
import { registerMarkdownTools } from './register/markdown.js';
import { defaultTransportRegistry } from './transport/index.js';
import { createLogger, childLogger } from './core/logger.js';
import { initMetrics, updateServerInfo } from './core/metrics.js';

const log = childLogger('main');

async function main() {
  createLogger(); // initialize root logger
  initMetrics(); // initialize Prometheus metrics (no-op for stdio)
  const ctx = await createServerContext();
  registerHelpers(ctx);
  registerCatalogTools(ctx);
  registerResources(ctx);
  registerPromptsTools(ctx);
  registerObsidianTools(ctx);
  registerProjectTools(ctx);
  registerBulkTools(ctx);
  registerTasksTools(ctx);
  registerKnowledgeTools(ctx);
  registerSearchTools(ctx);
  registerProjectResources(ctx);
  registerSearchResources(ctx);
  registerAliases(ctx);
  registerToolsIntrospection(ctx);
  registerDebugResources(ctx);
  registerDependencyTools(ctx);
  registerDashboardTools(ctx);
  registerMarkdownTools(ctx);

  // Update metrics with tool count
  updateServerInfo({ toolCount: ctx.toolNames.size });

  // ===== Transport Selection (via registry) =====
  const transportType = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();
  const port = parseInt(process.env.MCP_PORT || '3001', 10);
  const host = process.env.MCP_HOST || '0.0.0.0';

  const adapter = defaultTransportRegistry.createTransport({
    type: transportType,
    options: { port, host },
  });

  await adapter.connect(ctx);

  // Graceful shutdown for long-running transports (http, future ws/tcp)
  if (transportType !== 'stdio') {
    const shutdown = async (signal: string) => {
      log.info('%s received, shutting down...', signal);
      await adapter.close();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

main().catch((err) => { log.fatal({ err }, 'unhandled error in main()'); process.exit(1); });
