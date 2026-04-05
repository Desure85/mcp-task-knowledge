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
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
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
  const transport = new StdioServerTransport();
  await ctx.server.connect(transport);
}
main().catch((err) => { console.error(err); process.exit(1); });
