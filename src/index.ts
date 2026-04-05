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
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

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
  registerDependencyTools(ctx);

  // ===== Transport Selection =====
  const transportType = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();

  if (transportType === 'http') {
    // Streamable HTTP transport — serves MCP over HTTP (for Claude Desktop, Cursor, web clients)
    const port = parseInt(process.env.MCP_PORT || '3001', 10);
    const host = process.env.MCP_HOST || '0.0.0.0';
    const httpServer = createHttpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      // Collect body for POST requests
      if (req.method === 'POST') {
        const bodyChunks: Buffer[] = [];
        for await (const chunk of req) {
          bodyChunks.push(chunk);
        }
        const bodyStr = Buffer.concat(bodyChunks).toString('utf-8');
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(bodyStr);
        } catch {
          parsedBody = bodyStr;
        }
        await transport.handleRequest(req, res, parsedBody);
      } else {
        await transport.handleRequest(req, res);
      }
    });

    await ctx.server.connect(transport);

    httpServer.listen(port, host, () => {
      console.error(`[transport] MCP Streamable HTTP listening on http://${host}:${port}/mcp`);
    });

    process.on('SIGTERM', async () => {
      console.error('[transport] SIGTERM received, shutting down...');
      await transport.close();
      httpServer.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.error('[transport] SIGINT received, shutting down...');
      await transport.close();
      httpServer.close();
      process.exit(0);
    });
  } else {
    // Default: stdio transport (for Claude Code, Windsurf, direct pipe usage)
    const transport = new StdioServerTransport();
    await ctx.server.connect(transport);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
