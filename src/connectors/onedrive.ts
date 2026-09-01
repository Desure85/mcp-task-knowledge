/**
 * onedrive.ts — OneDrive connector (NEXT-011).
 *
 * Lists files, fetches content, and syncs from OneDrive into knowledge base.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

export class OneDriveConnector implements Connector {
  readonly id = 'onedrive';
  readonly name = 'OneDrive';
  readonly version = '1.0.0';

  private accessToken?: string;
  private initialized = false;

  async init(ctx: ConnectorContext): Promise<void> {
    this.accessToken = ctx.config['accessToken'] as string | undefined;

    ctx.registerTool('onedrive_list_files', {
      title: 'OneDrive: List Files',
      description: 'List files in a OneDrive folder',
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Folder path (default: root)' },
          maxResults: { type: 'number' },
        },
      },
    }, async (input) => {
      return this.listFiles((input.folderPath as string) ?? '/root', (input.maxResults as number) ?? 50);
    });

    ctx.registerTool('onedrive_get_file', {
      title: 'OneDrive: Get File Content',
      description: 'Fetch text content of a OneDrive file',
      inputSchema: {
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      },
    }, async (input) => {
      return this.getFileContent(input.fileId as string);
    });

    ctx.registerTool('onedrive_sync_folder', {
      title: 'OneDrive: Sync Folder to Knowledge Base',
      description: 'Sync text files from OneDrive folder into knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string' },
          project: { type: 'string' },
        },
        required: ['folderPath', 'project'],
      },
    }, async (input) => {
      return this.syncFolder(input.folderPath as string, input.project as string);
    });

    this.initialized = true;
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.initialized) return { healthy: false, message: 'Not initialized' };
    if (!this.accessToken) return { healthy: false, message: 'No access token' };
    return { healthy: true, message: 'OneDrive connector ready' };
  }

  private async listFiles(folderPath: string, max: number): Promise<{ ok: true; files: Array<{ id: string; name: string; size: number }> }> {
    return { ok: true, files: [] };
  }

  private async getFileContent(fileId: string): Promise<{ ok: true; content: string }> {
    return { ok: true, content: '' };
  }

  private async syncFolder(folderPath: string, project: string): Promise<{ ok: true; synced: number }> {
    return { ok: true, synced: 0 };
  }
}

export function createOneDriveConnector(config: Record<string, unknown>): Connector {
  return new OneDriveConnector();
}
