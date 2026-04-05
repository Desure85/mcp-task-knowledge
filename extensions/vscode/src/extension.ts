import * as vscode from 'vscode';
import { MCPClient } from './mcpClient';
import { TasksTreeProvider } from './tasksTreeProvider';
import { KnowledgeTreeProvider } from './knowledgeTreeProvider';
import { registerCommands, TasksProviderRef, KnowledgeProviderRef } from './commands';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const client = new MCPClient(context);

  const tasksProvider = new TasksTreeProvider(client);
  const knowledgeProvider = new KnowledgeTreeProvider(client);

  const providerRefs: TasksProviderRef = { instance: tasksProvider };
  const knowledgeRefs: KnowledgeProviderRef = { instance: knowledgeProvider };

  // Register tree views
  context.subscriptions.push(
    vscode.window.createTreeView('tasksTree', {
      treeDataProvider: tasksProvider,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView('knowledgeTree', {
      treeDataProvider: knowledgeProvider,
      showCollapseAll: true,
    })
  );

  // Register all commands
  registerCommands(context, client, providerRefs, knowledgeRefs);

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(plug) MCP';
  statusItem.tooltip = 'MCP Task & Knowledge — Click to reconnect';
  statusItem.command = 'mcpTaskKnowledge.reconnectServer';
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Update status bar on connection change
  const updateStatusBar = () => {
    if (client.connected) {
      statusItem.text = '$(check) MCP Connected';
      statusItem.tooltip = 'Connected to MCP server — Click to reconnect';
    } else {
      statusItem.text = '$(plug) MCP Disconnected';
      statusItem.tooltip = 'Disconnected — Click to connect';
    }
  };

  // Watch for connection changes
  const interval = setInterval(updateStatusBar, 2000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  // Auto-connect on activation
  const autoConnect = vscode.workspace.getConfiguration('mcpTaskKnowledge')
    .get<boolean>('autoConnect', true);

  if (autoConnect) {
    vscode.window.setStatusBarMessage('Connecting to MCP server...');
    const connected = await client.connect();
    if (connected) {
      vscode.window.setStatusBarMessage('MCP server connected', 3000);
    }
  }

  // Push client disposal
  context.subscriptions.push({
    dispose: () => client.dispose(),
  });
}

export function deactivate(): void {
  // Cleanup handled by subscriptions
}
