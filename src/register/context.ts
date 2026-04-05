/**
 * ServerContext type — единая зависимость для всех модулей регистрации.
 * Все runtime-состояние, доступное инструментам и ресурсам, проходит через этот интерфейс.
 */

import type { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ServerContext {
  server: McpServer;
  cfg: any;
  catalogCfg: any;
  catalogProvider: any;
  
  vectorAdapter: any | undefined;
  vectorInitAttempted: boolean;
  ensureVectorAdapter: () => Promise<any | undefined>;

  toolRegistry: Map<string, { 
    title?: string; 
    description?: string; 
    inputSchema?: Record<string, any>; 
    handler?: (params: any) => Promise<any> 
  }>;
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