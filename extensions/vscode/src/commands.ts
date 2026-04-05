import * as vscode from 'vscode';
import { MCPClient, TaskItem, KnowledgeItem } from './mcpClient';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: MCPClient,
  tasksProvider: TasksProviderRef,
  knowledgeProvider: KnowledgeProviderRef
): void {

  // ── Refresh ─────────────────────────────────────────────
  const refreshTasks = vscode.commands.registerCommand('mcpTaskKnowledge.refreshTasks', async () => {
    tasksProvider.instance?.refresh();
    vscode.window.setStatusBarMessage('Tasks refreshed', 2000);
  });

  const refreshKnowledge = vscode.commands.registerCommand('mcpTaskKnowledge.refreshKnowledge', async () => {
    knowledgeProvider.instance?.refresh();
    vscode.window.setStatusBarMessage('Knowledge refreshed', 2000);
  });

  // ── Create Task ─────────────────────────────────────────
  const createTask = vscode.commands.registerCommand('mcpTaskKnowledge.createTask', async (parentId?: string) => {
    const title = await vscode.window.showInputBox({
      prompt: 'Task title',
      placeHolder: 'Enter task title...',
      validateInput: (v) => v.trim() ? undefined : 'Title is required',
    });
    if (!title) return;

    const description = await vscode.window.showInputBox({
      prompt: 'Description (optional)',
      placeHolder: 'Enter description...',
    });

    const priority = await vscode.window.showQuickPick(['low', 'medium', 'high'], {
      placeHolder: 'Priority',
      canPickMany: false,
    });

    const result = await client.createTask({
      title: title.trim(),
      description: description?.trim() || undefined,
      priority: priority || 'medium',
      parentId,
    });

    if (result) {
      vscode.window.showInformationMessage(`Task created: ${result.title}`);
      tasksProvider.instance?.refresh();
    } else {
      vscode.window.showErrorMessage('Failed to create task');
    }
  });

  // ── Update Task Status ──────────────────────────────────
  const updateStatus = vscode.commands.registerCommand('mcpTaskKnowledge.updateTaskStatus', async (task?: TaskItem) => {
    let targetTask: TaskItem | undefined = task;

    if (!targetTask) {
      // Quick pick to select task
      const tasks = await client.listTasks();
      const pick = await vscode.window.showQuickPick(
        tasks.map(t => ({
          label: `${STATUS_LABEL(t.status)} ${t.title}`,
          task: t,
        })),
        { placeHolder: 'Select task...' }
      );
      targetTask = pick?.task;
    }

    if (!targetTask) return;

    const newStatus = await vscode.window.showQuickPick(
      ['pending', 'in_progress', 'blocked', 'completed', 'closed'],
      {
        placeHolder: `Current: ${targetTask.status}. New status:`,
      }
    );

    if (!newStatus || newStatus === targetTask.status) return;

    const result = await client.updateTask(targetTask.id, { status: newStatus });
    if (result) {
      vscode.window.showInformationMessage(`${targetTask.title} → ${newStatus}`);
      tasksProvider.instance?.refresh();
    } else {
      vscode.window.showErrorMessage('Failed to update task');
    }
  });

  // ── Show Task Details ───────────────────────────────────
  const showDetails = vscode.commands.registerCommand('mcpTaskKnowledge.showTaskDetails', async (task?: TaskItem) => {
    let targetTask: TaskItem | undefined = task;

    if (!targetTask) {
      const tasks = await client.listTasks();
      const pick = await vscode.window.showQuickPick(
        tasks.map(t => ({ label: t.title, task: t })),
        { placeHolder: 'Select task...' }
      );
      targetTask = pick?.task;
    }

    if (!targetTask) return;

    // Fetch full details
    const full = await client.getTask(targetTask.id);
    const t = full || targetTask;

    const panel = vscode.window.createWebviewPanel(
      'taskDetails',
      `Task: ${t.title}`,
      vscode.ViewColumn.One,
      { enableScripts: false }
    );

    panel.webview.html = buildTaskDetailsHTML(t);
  });

  // ── Add Subtask ─────────────────────────────────────────
  const addSubtask = vscode.commands.registerCommand('mcpTaskKnowledge.addSubtask', async (task?: TaskItem) => {
    let parentTask: TaskItem | undefined = task;

    if (!parentTask) {
      const tasks = await client.listTasks();
      const pick = await vscode.window.showQuickPick(
        tasks.map(t => ({ label: t.title, task: t })),
        { placeHolder: 'Select parent task...' }
      );
      parentTask = pick?.task;
    }

    if (!parentTask) return;

    const title = await vscode.window.showInputBox({
      prompt: `Subtask for "${parentTask.title}"`,
      placeHolder: 'Enter subtask title...',
      validateInput: (v) => v.trim() ? undefined : 'Title is required',
    });
    if (!title) return;

    const result = await client.addSubtask(parentTask.id, { title: title.trim() });
    if (result) {
      vscode.window.showInformationMessage(`Subtask created: ${result.title}`);
      tasksProvider.instance?.refresh();
    } else {
      vscode.window.showErrorMessage('Failed to create subtask');
    }
  });

  // ── Set Dependencies ────────────────────────────────────
  const setDeps = vscode.commands.registerCommand('mcpTaskKnowledge.setDependencies', async (task?: TaskItem) => {
    let targetTask: TaskItem | undefined = task;

    if (!targetTask) {
      const tasks = await client.listTasks();
      const pick = await vscode.window.showQuickPick(
        tasks.map(t => ({ label: t.title, task: t })),
        { placeHolder: 'Select task...' }
      );
      targetTask = pick?.task;
    }

    if (!targetTask) return;

    const allTasks = await client.listTasks();
    const otherTasks = allTasks.filter(t => t.id !== targetTask.id);

    const selected = await vscode.window.showQuickPick(
      otherTasks.map(t => ({
        label: t.title,
        description: t.status,
        picked: (targetTask.dependsOn || []).includes(t.id),
        task: t,
      })),
      {
        placeHolder: 'Select dependencies (tasks that must complete first)',
        canPickMany: true,
      }
    );

    if (!selected) return;

    const depsResult = await client.setDependencies(
      targetTask.id,
      selected.map(s => s.task.id)
    );

    if (depsResult.success) {
      vscode.window.showInformationMessage(`Dependencies updated for "${targetTask.title}"`);
      tasksProvider.instance?.refresh();
    } else {
      vscode.window.showErrorMessage(`Failed: ${depsResult.error}`);
    }
  });

  // ── Add Knowledge ───────────────────────────────────────
  const addKnowledge = vscode.commands.registerCommand('mcpTaskKnowledge.addKnowledge', async () => {
    const title = await vscode.window.showInputBox({
      prompt: 'Knowledge entry title',
      placeHolder: 'Enter title...',
      validateInput: (v) => v.trim() ? undefined : 'Title is required',
    });
    if (!title) return;

    const type = await vscode.window.showQuickPick(
      ['component', 'api', 'schemas', 'routes', 'overview', 'general'],
      { placeHolder: 'Entry type' }
    );

    const doc = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: 'Select markdown file (optional)',
      filters: { 'Markdown': ['md', 'markdown'], 'All': ['*'] },
    });

    let content = '';
    if (doc && doc[0]) {
      content = Buffer.from(await vscode.workspace.fs.readFile(doc[0])).toString('utf-8');
    }

    if (!content) {
      const desc = await vscode.window.showInputBox({
        prompt: 'Content (or skip to use empty)',
        placeHolder: 'Enter markdown content...',
      });
      content = desc || '';
    }

    // Use knowledge_list/list to find how to create... 
    // Actually the MCP server doesn't have a knowledge_create tool directly
    // Let's use the raw tool call
    const result = await client.callTool('knowledge_create', {
      project: vscode.workspace.getConfiguration('mcpTaskKnowledge').get('project', 'default'),
      title: title.trim(),
      content,
      type: type || 'general',
    });

    if (result.success) {
      vscode.window.showInformationMessage(`Knowledge entry created: ${title}`);
      knowledgeProvider.instance?.refresh();
    } else {
      vscode.window.showErrorMessage(`Failed: ${result.error}`);
    }
  });

  // ── Show Knowledge Entry ────────────────────────────────
  const showKnowledge = vscode.commands.registerCommand('mcpTaskKnowledge.showKnowledgeEntry', async (item?: KnowledgeItem) => {
    let targetItem: KnowledgeItem | undefined = item;

    if (!targetItem) {
      const items = await client.listKnowledge();
      const pick = await vscode.window.showQuickPick(
        items.map(i => ({ label: i.title, item: i })),
        { placeHolder: 'Select knowledge entry...' }
      );
      targetItem = pick?.item;
    }

    if (!targetItem) return;

    // Fetch full content
    const full = await client.getKnowledge(targetItem.id);
    const k = full || targetItem;

    const panel = vscode.window.createWebviewPanel(
      'knowledgeEntry',
      k.title,
      vscode.ViewColumn.One,
      { enableScripts: false }
    );

    panel.webview.html = buildKnowledgeHTML(k);
  });

  // ── Search ──────────────────────────────────────────────
  const searchAll = vscode.commands.registerCommand('mcpTaskKnowledge.searchAll', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search tasks and knowledge',
      placeHolder: 'Enter search query...',
    });
    if (!query?.trim()) return;

    const [tasks, knowledge] = await Promise.all([
      client.searchTasks(query.trim()),
      client.searchKnowledge(query.trim()),
    ]);

    if (tasks.length === 0 && knowledge.length === 0) {
      vscode.window.showInformationMessage(`No results for "${query}"`);
      return;
    }

    // Show results in quick pick
    const items: vscode.QuickPickItem[] = [
      ...(tasks.length > 0 ? [{ kind: vscode.QuickPickItemKind.Separator, label: `Tasks (${tasks.length})` }] : []),
      ...tasks.map(t => ({
        label: `${STATUS_LABEL(t.status)} ${t.title}`,
        description: t.priority,
        detail: t.description?.slice(0, 100),
      })),
      ...(knowledge.length > 0 ? [{ kind: vscode.QuickPickItemKind.Separator, label: `Knowledge (${knowledge.length})` }] : []),
      ...knowledge.map(k => ({
        label: `📄 ${k.title}`,
        description: k.type,
        detail: k.content?.slice(0, 100),
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Found ${tasks.length + knowledge.length} results`,
    });
  });

  // ── Show DAG ────────────────────────────────────────────
  const showDAG = vscode.commands.registerCommand('mcpTaskKnowledge.showDAG', async () => {
    const dag = await client.getDAG();
    if (!dag) {
      vscode.window.showErrorMessage('Failed to load dependency graph');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'dagView',
      'Task Dependency Graph',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    // Generate Mermaid diagram
    const edges = dag.edges || [];
    let mermaid = 'graph TD\n';
    for (const edge of edges) {
      mermaid += `  ${sanitizeId(edge.from)} --> ${sanitizeId(edge.to)}\n`;
    }

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Task DAG</title>
        <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
          .stats { margin-bottom: 20px; }
          .stats span { margin-right: 20px; }
          .mermaid { text-align: center; }
        </style>
      </head>
      <body>
        <div class="stats">
          <span><strong>Total tasks:</strong> ${dag.totalTasks || 0}</span>
          <span><strong>With deps:</strong> ${dag.tasksWithDeps || 0}</span>
          <span><strong>Blocked:</strong> ${dag.blockedCount || 0}</span>
        </div>
        <div class="mermaid">${mermaid}</div>
        <script>mermaid.initialize({ startOnLoad: true, theme: 'dark' });</script>
      </body>
      </html>
    `;
  });

  // ── Export Mermaid ──────────────────────────────────────
  const exportMermaid = vscode.commands.registerCommand('mcpTaskKnowledge.exportMermaid', async () => {
    const dag = await client.getDAG();
    if (!dag) {
      vscode.window.showErrorMessage('Failed to load dependency graph');
      return;
    }

    let mermaid = 'graph TD\n';
    for (const edge of (dag.edges || [])) {
      mermaid += `  ${sanitizeId(edge.from)} --> ${sanitizeId(edge.to)}\n`;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: `# Task Dependency Graph\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n`,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc);
  });

  // ── Open Web UI ─────────────────────────────────────────
  const openWebUI = vscode.commands.registerCommand('mcpTaskKnowledge.openWebUI', async () => {
    const url = vscode.workspace.getConfiguration('mcpTaskKnowledge').get<string>('webUIUrl', 'http://localhost:3000');
    vscode.env.openExternal(vscode.Uri.parse(url));
  });

  // ── Configure Server ────────────────────────────────────
  const configure = vscode.commands.registerCommand('mcpTaskKnowledge.configureServer', async () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'mcpTaskKnowledge');
  });

  // ── Reconnect ───────────────────────────────────────────
  const reconnect = vscode.commands.registerCommand('mcpTaskKnowledge.reconnectServer', async () => {
    vscode.window.setStatusBarMessage('Reconnecting to MCP server...');
    const ok = await client.connect();
    if (ok) {
      vscode.window.setStatusBarMessage('Connected to MCP server', 3000);
      tasksProvider.instance?.refresh();
      knowledgeProvider.instance?.refresh();
    }
  });

  // ── Open Task Tree ──────────────────────────────────────
  const openTree = vscode.commands.registerCommand('mcpTaskKnowledge.openTaskTree', async () => {
    vscode.commands.executeCommand('workbench.view.extension.taskKnowledgeExplorer');
  });

  // ── Archive completed ───────────────────────────────────
  const archiveCompleted = vscode.commands.registerCommand('mcpTaskKnowledge.archiveTasks', async () => {
    const answer = await vscode.window.showWarningMessage(
      'Archive all completed tasks?',
      { modal: true },
      'Archive'
    );
    if (answer !== 'Archive') return;

    const result = await client.callTool('tasks_bulk_archive', {
      project: vscode.workspace.getConfiguration('mcpTaskKnowledge').get('project', 'default'),
    });

    if (result.success) {
      vscode.window.showInformationMessage('Completed tasks archived');
      tasksProvider.instance?.refresh();
    } else {
      vscode.window.showErrorMessage(`Failed: ${result.error}`);
    }
  });

  context.subscriptions.push(
    refreshTasks, refreshKnowledge, createTask, updateStatus,
    showDetails, addSubtask, setDeps, addKnowledge, showKnowledge,
    searchAll, showDAG, exportMermaid, openWebUI, configure,
    reconnect, openTree, archiveCompleted
  );
}

// ── Helpers ───────────────────────────────────────────────

function STATUS_LABEL(status: string): string {
  switch (status) {
    case 'in_progress': return '▶';
    case 'completed': return '✓';
    case 'closed': return '✕';
    case 'blocked': return '⊘';
    default: return '○';
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function buildTaskDetailsHTML(task: TaskItem): string {
  const statusColors: Record<string, string> = {
    pending: '#888',
    in_progress: '#007acc',
    blocked: '#d32f2f',
    completed: '#388e3c',
    closed: '#555',
  };

  const depsSection = task.dependsOn?.length
    ? `<h3>Dependencies</h3><p>${task.dependsOn.join(', ')}</p>`
    : '';

  const tagsSection = task.tags?.length
    ? `<h3>Tags</h3><p>${task.tags.map(t => `<span style="background:#333;padding:2px 8px;border-radius:3px;margin-right:4px">${t}</span>`).join('')}</p>`
    : '';

  const linksSection = task.links?.length
    ? `<h3>Links</h3><ul>${task.links.map(l => `<li><a href="${l}">${l}</a></li>`).join('')}</ul>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); padding: 24px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); max-width: 700px; }
  h1 { margin-top: 0; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
  .meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 3px; color: white; font-size: 12px; }
  h3 { margin-top: 20px; color: var(--vscode-panelTitle-activeForeground); }
  .desc { white-space: pre-wrap; background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; margin-top: 8px; }
</style></head><body>
  <h1>${escHtml(task.title)}</h1>
  <div class="meta">
    <span class="status" style="background:${statusColors[task.status] || '#555'}">${task.status}</span>
    <span style="margin-left:8px">Priority: <strong>${task.priority}</strong></span>
    <span style="margin-left:8px">ID: <code>${task.id}</code></span>
  </div>
  ${task.description ? `<h3>Description</h3><div class="desc">${escHtml(task.description)}</div>` : ''}
  ${depsSection}
  ${tagsSection}
  ${linksSection}
  <div class="meta" style="margin-top:24px">
    <span>Created: ${new Date(task.createdAt).toLocaleString()}</span><br>
    <span>Updated: ${new Date(task.updatedAt).toLocaleString()}</span>
  </div>
</body></html>`;
}

function buildKnowledgeHTML(item: KnowledgeItem): string {
  // Basic markdown to HTML conversion
  const body = item.content
    ? item.content
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>')
    : '<em>No content</em>';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); padding: 24px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); max-width: 800px; line-height: 1.6; }
  h1 { margin-top: 0; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
  .meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  h2, h3 { margin-top: 20px; color: var(--vscode-panelTitle-activeForeground); }
</style></head><body>
  <h1>${escHtml(item.title)}</h1>
  <div class="meta">
    <span>Type: <strong>${item.type || 'general'}</strong></span>
    ${item.tags?.length ? ` | Tags: ${item.tags.join(', ')}` : ''}
  </div>
  <div class="content">${body}</div>
  <div class="meta" style="margin-top:24px">
    <span>Created: ${new Date(item.createdAt).toLocaleString()}</span><br>
    <span>Updated: ${new Date(item.updatedAt).toLocaleString()}</span>
  </div>
</body></html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Provider refs for lazy binding
export interface TasksProviderRef {
  instance: import('./tasksTreeProvider').TasksTreeProvider | null;
}

export interface KnowledgeProviderRef {
  instance: import('./knowledgeTreeProvider').KnowledgeTreeProvider | null;
}
