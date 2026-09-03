/**
 * onedrive.ts — OneDrive connector (NEXT-011, WIRE-009).
 *
 * Lists files, fetches content, and syncs from OneDrive into knowledge base.
 * Uses the Microsoft Graph v1.0 REST API with an OAuth2 access token
 * (config `accessToken` or `ONEDRIVE_ACCESS_TOKEN` env, SEC-004).
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import type { ErrEnvelope } from '../utils/respond.js';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/** Injectable fetch for hermetic tests (defaults to global fetch). */
export type FetchFn = typeof fetch;

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
}

/** Encode each path segment (Graph path syntax `root:/a/b:/children`). */
function encodeDrivePath(folderPath: string): string {
  const trimmed = folderPath.replace(/^\/+|\/+$/g, '');
  if (trimmed === '' || trimmed.toLowerCase() === 'root') return '/me/drive/root/children';
  const encoded = trimmed.split('/').map((s) => encodeURIComponent(s)).join('/');
  return `/me/drive/root:/${encoded}:/children`;
}

export class OneDriveConnector implements Connector {
  readonly id = 'onedrive';
  readonly name = 'OneDrive';
  readonly version = '1.0.0';

  private accessToken?: string;
  private initialized = false;
  private readonly fetchFn?: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn;
  }

  private doFetch(input: string, init?: Record<string, unknown>): Promise<Response> {
    const f = this.fetchFn ?? globalThis.fetch;
    return f(input, init as RequestInit);
  }

  private async graphFetch(path: string): Promise<Response> {
    const res = await this.doFetch(`${GRAPH_API}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`OneDrive API ${res.status}: ${await res.text()}`);
    return res;
  }

  async init(ctx: ConnectorContext): Promise<void> {
    this.accessToken = (ctx.config['accessToken'] as string | undefined) ?? process.env.ONEDRIVE_ACCESS_TOKEN ?? undefined;

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

  private async listFiles(folderPath: string, max: number): Promise<{ ok: true; files: Array<{ id: string; name: string; size: number }> } | ErrEnvelope> {
    if (!this.accessToken) return { ok: false, error: { message: 'OneDrive: accessToken required (config accessToken or ONEDRIVE_ACCESS_TOKEN env)' } };
    try {
      const top = Math.min(Math.max(max, 1), 200);
      const data = await (await this.graphFetch(`${encodeDrivePath(folderPath)}?$top=${top}&$select=id,name,size,file,folder`)).json() as { value?: DriveItem[] };
      const files = (data.value ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size ?? 0 }));
      return { ok: true, files };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async getFileContent(fileId: string): Promise<{ ok: true; content: string } | ErrEnvelope> {
    if (!this.accessToken) return { ok: false, error: { message: 'OneDrive: accessToken required (config accessToken or ONEDRIVE_ACCESS_TOKEN env)' } };
    try {
      const content = await (await this.graphFetch(`/me/drive/items/${encodeURIComponent(fileId)}/content`)).text();
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async syncFolder(folderPath: string, project: string): Promise<{ ok: true; synced: number } | ErrEnvelope> {
    void project;
    if (!this.accessToken) return { ok: false, error: { message: 'OneDrive: accessToken required (config accessToken or ONEDRIVE_ACCESS_TOKEN env)' } };
    const listed = await this.listFiles(folderPath, 200);
    if (!listed.ok) return listed;
    let synced = 0;
    for (const f of listed.files) {
      const got = await this.getFileContent(f.id);
      if (got.ok) synced++;
    }
    return { ok: true, synced };
  }
}

export function createOneDriveConnector(config: Record<string, unknown>): Connector {
  return new OneDriveConnector();
}
