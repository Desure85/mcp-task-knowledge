import * as vscode from 'vscode';
import { MCPClient, KnowledgeItem } from './mcpClient';

const TYPE_ICONS: Record<string, string> = {
  component: 'gear',
  api: 'symbol-method',
  schemas: 'file-symlink-file',
  routes: 'go-to-file',
  overview: 'book',
};

export class KnowledgeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly knowledge: KnowledgeItem,
    public readonly contextValue: string = 'knowledge'
  ) {
    super(knowledge.title, vscode.TreeItemCollapsibleState.None);

    this.description = knowledge.type || '';
    this.tooltip = this.buildTooltip(knowledge);
    this.iconPath = new vscode.ThemeIcon(TYPE_ICONS[knowledge.type || ''] || 'file-text');

    this.contextValue = contextValue;

    this.command = {
      command: 'mcpTaskKnowledge.showKnowledgeEntry',
      title: 'Show Entry',
      arguments: [knowledge],
    };
  }

  private buildTooltip(item: KnowledgeItem): string {
    const lines = [
      `**${item.title}**`,
      `Type: ${item.type || 'general'}`,
    ];
    if (item.tags?.length) {
      lines.push(`Tags: ${item.tags.join(', ')}`);
    }
    if (item.source) {
      lines.push(`Source: ${item.source}`);
    }
    lines.push(`Updated: ${new Date(item.updatedAt).toLocaleString()}`);
    return lines.join('\n');
  }
}

export class KnowledgeTypeGroup extends vscode.TreeItem {
  constructor(
    public readonly type: string,
    public readonly items: KnowledgeItem[]
  ) {
    super(`${type || 'General'} (${items.length})`, items.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(TYPE_ICONS[type || ''] || 'folder');
    this.contextValue = 'knowledgeGroup';
  }
}

export class KnowledgeTreeProvider implements vscode.TreeDataProvider<KnowledgeTreeItem | KnowledgeTypeGroup> {
  private _onDidChangeTreeData = new vscode.EventEmitter<KnowledgeTreeItem | KnowledgeTypeGroup | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private client: MCPClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: KnowledgeTreeItem | KnowledgeTypeGroup): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: KnowledgeTreeItem | KnowledgeTypeGroup): Promise<(KnowledgeTreeItem | KnowledgeTypeGroup)[]> {
    if (!this.client.connected) return [];

    if (!element) {
      const items = await this.client.listKnowledge();
      return this.groupByType(items);
    }

    if (element instanceof KnowledgeTypeGroup) {
      return element.items.map(i => new KnowledgeTreeItem(i));
    }

    return [];
  }

  private groupByType(items: KnowledgeItem[]): KnowledgeTypeGroup[] {
    const groups: Record<string, KnowledgeItem[]> = {};

    for (const item of items) {
      const type = item.type || 'general';
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    }

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => new KnowledgeTypeGroup(type, items));
  }
}
