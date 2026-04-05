import * as vscode from 'vscode';
import { MCPClient, TaskItem } from './mcpClient';

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  in_progress: '◐',
  blocked: '⊘',
  completed: '●',
  closed: '◌',
};

const PRIORITY_ICONS: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

export class TaskTreeItem extends vscode.TreeItem {
  constructor(
    public readonly task: TaskItem,
    public readonly contextValue: string = 'task'
  ) {
    super(task.title, vscode.TreeItemCollapsibleState.None);

    const icon = STATUS_ICONS[task.status] || '○';
    const priority = PRIORITY_ICONS[task.priority] || '';

    this.label = `${icon} ${task.title}`;
    this.description = `${priority} ${task.priority}`;
    this.tooltip = this.buildTooltip(task);
    this.iconPath = this.getStatusIcon(task.status);

    this.contextValue = contextValue;

    // Command on click — show details
    this.command = {
      command: 'mcpTaskKnowledge.showTaskDetails',
      title: 'Show Details',
      arguments: [task],
    };
  }

  private buildTooltip(task: TaskItem): string {
    const lines = [
      `**${task.title}**`,
      `Status: ${task.status}  |  Priority: ${task.priority}`,
    ];
    if (task.description) {
      lines.push('', task.description.length > 200 ? task.description.slice(0, 200) + '…' : task.description);
    }
    if (task.tags?.length) {
      lines.push(`Tags: ${task.tags.join(', ')}`);
    }
    if (task.dependsOn?.length) {
      lines.push(`Depends on: ${task.dependsOn.length} task(s)`);
    }
    lines.push(`Updated: ${new Date(task.updatedAt).toLocaleString()}`);
    return lines.join('\n');
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'in_progress': return new vscode.ThemeIcon('loading~spin');
      case 'completed': return new vscode.ThemeIcon('check');
      case 'closed': return new vscode.ThemeIcon('close');
      case 'blocked': return new vscode.ThemeIcon('block');
      default: return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class TaskStatusGroup extends vscode.TreeItem {
  constructor(
    public readonly status: string,
    public readonly tasks: TaskItem[]
  ) {
    super(`${status} (${tasks.length})`, tasks.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(this.statusIcon(status));
    this.contextValue = 'statusGroup';
  }

  private statusIcon(status: string): string {
    switch (status) {
      case 'in_progress': return 'play';
      case 'completed': return 'check-all';
      case 'closed': return 'close-all';
      case 'blocked': return 'warning';
      default: return 'circle-large-outline';
    }
  }
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskTreeItem | TaskStatusGroup> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | TaskStatusGroup | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private client: MCPClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TaskTreeItem | TaskStatusGroup): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskTreeItem | TaskStatusGroup): Promise<(TaskTreeItem | TaskStatusGroup)[]> {
    if (!this.client.connected) return [];

    if (!element) {
      // Root level — show status groups
      const tasks = await this.client.listTasks();
      return this.groupByStatus(tasks);
    }

    if (element instanceof TaskStatusGroup) {
      return element.tasks.map(t => new TaskTreeItem(t));
    }

    return [];
  }

  private groupByStatus(tasks: TaskItem[]): TaskStatusGroup[] {
    const groups: Record<string, TaskItem[]> = {
      in_progress: [],
      blocked: [],
      pending: [],
      completed: [],
      closed: [],
    };

    for (const task of tasks) {
      const status = task.status || 'pending';
      if (!groups[status]) groups[status] = [];
      groups[status].push(task);
    }

    // Only show non-empty groups
    return Object.entries(groups)
      .filter(([, tasks]) => tasks.length > 0)
      .map(([status, tasks]) => new TaskStatusGroup(status, tasks));
  }
}
