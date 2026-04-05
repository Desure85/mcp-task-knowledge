import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type TransportType = 'stdio' | 'http';

export interface MCPToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'closed';
  priority: 'low' | 'medium' | 'high';
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  links?: string[];
  parentId?: string;
  dependsOn?: string[];
  project: string;
  archived?: boolean;
  trashed?: boolean;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  project: string;
  parentId?: string;
  type?: string;
  source?: string;
}

export interface TreeNode {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  parentId?: string;
  children: TreeNode[];
}

export class MCPClient {
  private client: Client;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  private _connected = false;
  private process?: import('child_process').ChildProcess;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private context: vscode.ExtensionContext) {
    this.client = new Client({
      name: 'vscode-mcp-task-knowledge',
      version: '0.1.0',
    }, {
      capabilities: {}
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<boolean> {
    try {
      await this.disconnect();

      const config = vscode.workspace.getConfiguration('mcpTaskKnowledge');
      const transportType = config.get<TransportType>('transport', 'stdio');

      if (transportType === 'stdio') {
        const cmd = config.get<string>('serverCommand', 'npx');
        const args = config.get<string[]>('serverArgs', ['-y', 'mcp-task-knowledge']);

        this.transport = new StdioClientTransport({
          command: cmd,
          args,
        });
      } else {
        const url = config.get<string>('httpUrl', 'http://localhost:3001');
        this.transport = new StreamableHTTPClientTransport(new URL(url));
      }

      this.client.onerror = (error) => {
        console.error('[MCP Client] Error:', error);
        this.setConnected(false);
      };

      this.client.onclose = () => {
        console.log('[MCP Client] Connection closed');
        this.setConnected(false);
      };

      await this.client.connect(this.transport);
      this.setConnected(true);

      // Store reference to child process for cleanup
      if (this.transport instanceof StdioClientTransport) {
        // Access the internal process if available
        try {
          const proc = (this.transport as any)._process;
          if (proc) {
            this.process = proc;
          }
        } catch {
          // Process reference not available
        }
      }

      this.startAutoRefresh();
      return true;
    } catch (err: any) {
      console.error('[MCP Client] Connection failed:', err);
      this.setConnected(false);
      vscode.window.showErrorMessage(`MCP connection failed: ${err.message}`);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.stopAutoRefresh();
    try {
      if (this._connected) {
        await this.client.close();
      }
    } catch {
      // Ignore close errors
    }

    if (this.transport instanceof StdioClientTransport && this.process) {
      try {
        this.process.kill();
      } catch {
        // Process may already be dead
      }
      this.process = undefined;
    }

    this.transport = null;
    this.setConnected(false);
  }

  private setConnected(value: boolean): void {
    this._connected = value;
    vscode.commands.executeCommand('setContext', 'mcpTaskKnowledge.connected', value);
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    const config = vscode.workspace.getConfiguration('mcpTaskKnowledge');
    const interval = config.get<number>('refreshInterval', 30);
    if (interval > 0 && config.get<boolean>('autoRefresh', true)) {
      this.refreshTimer = setInterval(() => {
        vscode.commands.executeCommand('mcpTaskKnowledge.refreshTasks');
      }, interval * 1000);
    }
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<MCPToolResult> {
    if (!this._connected) {
      return { success: false, error: 'Not connected to MCP server' };
    }

    try {
      const result = await this.client.callTool({ name, arguments: args });

      // MCP SDK returns content array
      const content = (result as any).content;
      if (!content || content.length === 0) {
        return { success: true, data: null };
      }

      // Parse text content
      for (const item of content) {
        if (item.type === 'text') {
          try {
            const parsed = JSON.parse(item.text);
            // Check if it's an error response
            if (parsed.isError || parsed.error) {
              return { success: false, error: parsed.error || parsed.message || 'Unknown error' };
            }
            return { success: true, data: parsed };
          } catch {
            // Not JSON, return raw text
            return { success: true, data: item.text };
          }
        }
      }

      return { success: true, data: content };
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown MCP error' };
    }
  }

  // ── Task operations ─────────────────────────────────────

  async listTasks(options?: {
    project?: string;
    status?: string;
    priority?: string;
    includeArchived?: boolean;
  }): Promise<TaskItem[]> {
    const project = options?.project || this.getDefaultProject();
    const result = await this.callTool('tasks_list', {
      project,
      status: options?.status,
      priority: options?.priority,
      includeArchived: options?.includeArchived ?? false,
    });
    if (!result.success) return [];
    const tasks = result.data?.tasks || result.data || [];
    return Array.isArray(tasks) ? tasks : [];
  }

  async getTask(id: string, project?: string): Promise<TaskItem | null> {
    const result = await this.callTool('tasks_get', {
      project: project || this.getDefaultProject(),
      id,
    });
    if (!result.success) return null;
    return result.data?.task || result.data || null;
  }

  async createTask(params: {
    title: string;
    description?: string;
    priority?: string;
    tags?: string[];
    links?: string[];
    parentId?: string;
    project?: string;
  }): Promise<TaskItem | null> {
    const result = await this.callTool('tasks_create', {
      project: params.project || this.getDefaultProject(),
      title: params.title,
      description: params.description,
      priority: params.priority || 'medium',
      tags: params.tags,
      links: params.links,
      parentId: params.parentId,
    });
    if (!result.success) return null;
    return result.data?.task || result.data || null;
  }

  async updateTask(id: string, updates: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    tags?: string[];
    links?: string[];
    project?: string;
  }): Promise<TaskItem | null> {
    const result = await this.callTool('tasks_update', {
      project: updates.project || this.getDefaultProject(),
      id,
      ...updates,
    });
    if (!result.success) return null;
    return result.data?.task || result.data || null;
  }

  async closeTask(id: string, project?: string): Promise<boolean> {
    const result = await this.callTool('tasks_close', {
      project: project || this.getDefaultProject(),
      id,
    });
    return result.success;
  }

  async getTaskTree(project?: string): Promise<TreeNode | null> {
    const result = await this.callTool('tasks_tree', {
      project: project || this.getDefaultProject(),
    });
    if (!result.success) return null;
    return result.data?.tree || result.data || null;
  }

  async addSubtask(parentId: string, params: {
    title: string;
    description?: string;
    priority?: string;
    project?: string;
  }): Promise<TaskItem | null> {
    const result = await this.callTool('tasks_add_subtask', {
      project: params.project || this.getDefaultProject(),
      parentId,
      title: params.title,
      description: params.description,
      priority: params.priority || 'medium',
    });
    if (!result.success) return null;
    return result.data?.task || result.data || null;
  }

  // ── Knowledge operations ────────────────────────────────

  async listKnowledge(options?: {
    project?: string;
    includeArchived?: boolean;
  }): Promise<KnowledgeItem[]> {
    const result = await this.callTool('knowledge_list', {
      project: options?.project || this.getDefaultProject(),
      includeArchived: options?.includeArchived ?? false,
    });
    if (!result.success) return [];
    const items = result.data?.knowledge || result.data || [];
    return Array.isArray(items) ? items : [];
  }

  async getKnowledge(id: string, project?: string): Promise<KnowledgeItem | null> {
    const result = await this.callTool('knowledge_get', {
      project: project || this.getDefaultProject(),
      id,
    });
    if (!result.success) return null;
    return result.data?.knowledge || result.data || null;
  }

  // ── Search operations ───────────────────────────────────

  async searchTasks(query: string, project?: string): Promise<TaskItem[]> {
    const result = await this.callTool('search_tasks', {
      project: project || this.getDefaultProject(),
      query,
    });
    if (!result.success) return [];
    const items = result.data?.results || result.data || [];
    return Array.isArray(items) ? items : [];
  }

  async searchKnowledge(query: string, project?: string): Promise<KnowledgeItem[]> {
    const result = await this.callTool('search_knowledge', {
      project: project || this.getDefaultProject(),
      query,
    });
    if (!result.success) return [];
    const items = result.data?.results || result.data || [];
    return Array.isArray(items) ? items : [];
  }

  // ── Dependency / DAG operations ─────────────────────────

  async getDAG(project?: string): Promise<any | null> {
    const result = await this.callTool('tasks_dag', {
      project: project || this.getDefaultProject(),
    });
    if (!result.success) return null;
    return result.data;
  }

  async setDependencies(taskId: string, dependsOn: string[], project?: string): Promise<MCPToolResult> {
    return this.callTool('tasks_set_deps', {
      project: project || this.getDefaultProject(),
      id: taskId,
      dependsOn,
    });
  }

  async getDependencies(taskId: string, project?: string): Promise<MCPToolResult> {
    return this.callTool('tasks_get_deps', {
      project: project || this.getDefaultProject(),
      id: taskId,
    });
  }

  // ── Utility ─────────────────────────────────────────────

  private getDefaultProject(): string {
    return vscode.workspace.getConfiguration('mcpTaskKnowledge').get<string>('project', 'default');
  }

  dispose(): void {
    this.stopAutoRefresh();
    this.disconnect();
  }
}
