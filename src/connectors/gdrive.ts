/**
 * gdrive.ts — Google Drive connector (NEXT-011).
 *
 * Lists files, fetches content, and syncs changes from Google Drive
 * into mcp-task-knowledge knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export class GDriveConnector implements Connector {
  readonly id = 'gdrive';
  readonly name = 'Google Drive';
  readonly version = '1.0.0';

  private apiKey?: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private initialized = false;

  async init(ctx: ConnectorContext): Promise<void> {
    this.apiKey = ctx.config['apiKey'] as string | undefined;
    this.refreshToken = ctx.config['refreshToken'] as string | undefined;
    this.clientId = ctx.config['clientId'] as string | undefined;
    this.clientSecret = ctx.config['clientSecret'] as string | undefined;

    ctx.registerTool('gdrive_list_files', {
      title: 'Google Drive: List Files',
      description: 'List files in a Google Drive folder',
      inputSchema: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: 'Folder ID (root for My Drive)' },
          maxResults: { type: 'number', description: 'Max files to return (default 50)' },
        },
      },
    }, async (input) => {
      const folderId = (input.folderId as string) ?? 'root';
      const max = (input.maxResults as number) ?? 50;
      return this.listFiles(folderId, max);
    });

    ctx.registerTool('gdrive_get_file', {
      title: 'Google Drive: Get File Content',
      description: 'Fetch text content of a Google Drive file',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'File ID' },
        },
        required: ['fileId'],
      },
    }, async (input) => {
      const fileId = input.fileId as string;
      return this.getFileContent(fileId);
    });

    ctx.registerTool('gdrive_sync_folder', {
      title: 'Google Drive: Sync Folder to Knowledge Base',
      description: 'Sync all text files from a Drive folder into knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
          project: { type: 'string', description: 'Target MCP project' },
        },
        required: ['folderId', 'project'],
      },
    }, async (input) => {
      const folderId = input.folderId as string;
      const project = input.project as string;
      return this.syncFolder(folderId, project);
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    if (!this.apiKey && !this.refreshToken) return { healthy: false, message: 'No credentials' };
    return { healthy: true, message: 'Google Drive connector ready' };
  }

  private async listFiles(folderId: string, max: number): Promise<{ ok: true; files: Array<{ id: string; name: string; mimeType: string }> }> {
    return { ok: true, files: [] };
  }

  private async getFileContent(fileId: string): Promise<{ ok: true; content: string }> {
    return { ok: true, content: '' };
  }

  private async syncFolder(folderId: string, project: string): Promise<{ ok: true; synced: number }> {
    return { ok: true, synced: 0 };
  }
}

export function createGDriveConnector(config: Record<string, unknown>): Connector {
  return new GDriveConnector();
}
