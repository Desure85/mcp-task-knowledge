/**
 * ServerContext type — единая зависимость для всех модулей регистрации.
 * Все runtime-состояние, доступное инструментам и ресурсам, проходит через этот интерфейс.
 */

import type { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { ServerConfig, CatalogConfig } from '../config.js';
import type { ServiceCatalogProvider } from '../catalog/provider.js';
import type { VectorSearchAdapter } from '../search/index.js';

export interface ServerContext {
  server: McpServer;
  cfg: ServerConfig;
  catalogCfg: CatalogConfig;
  catalogProvider: ServiceCatalogProvider;

  vectorAdapter: VectorSearchAdapter<unknown> | undefined;
  vectorInitAttempted: boolean;
  ensureVectorAdapter: () => Promise<VectorSearchAdapter<unknown> | undefined>;

  /** Typed tool registry with versioning, ETag, and pagination. */
  toolRegistry: ToolRegistry;
  resourceRegistry: Array<{
    id: string;
    uri: string;
    kind: 'static' | 'template';
    title?: string;
    description?: string;
    mimeType?: string;
  }>;
  toolNames: Set<string>;

  STRICT_TOOL_DEDUP: boolean;
  TOOLS_ENABLED: boolean;
  TOOL_RES_ENABLED: boolean;
  TOOL_RES_EXEC: boolean;

  REPO_ROOT: string;
  SERVER_CAPS: { resources: { list: boolean; read: boolean }; tools: { call: boolean } };

  normalizeBase64: (input: string) => string;
  makeResourceTemplate: (pattern: string) => ResourceTemplate;
  registerToolAsResource: (name: string) => void;

  triggerPromptsReindex?: (project: string) => Promise<void>;
}
