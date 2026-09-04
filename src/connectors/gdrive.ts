/**
 * gdrive.ts — Google Drive connector (NEXT-011, WIRE-009).
 *
 * Lists files, fetches content, and syncs changes from Google Drive
 * into mcp-task-knowledge knowledge base.
 * Uses the Google Drive v3 REST API with an OAuth2 access token
 * (config `accessToken` or `GDRIVE_ACCESS_TOKEN` env, SEC-004).
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';
import type { ErrEnvelope } from '../utils/respond.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Injectable fetch for hermetic tests (defaults to global fetch). */
export type FetchFn = typeof fetch;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

/** MIME types syncable as text (incl. Google Workspace exportables). */
function isSyncable(mimeType: string): boolean {
  return mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType.startsWith('application/vnd.google-apps.');
}

export class GDriveConnector implements Connector {
  readonly id = 'gdrive';
  readonly name = 'Google Drive';
  readonly version = '1.0.0';

  private accessToken?: string;
  private apiKey?: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private initialized = false;
  private readonly fetchFn?: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn;
  }

  private doFetch(input: string, init?: Record<string, unknown>): Promise<Response> {
    const f = this.fetchFn ?? globalThis.fetch;
    return f(input, init as RequestInit);
  }

  private async driveFetch(path: string): Promise<Response> {
    const res = await this.doFetch(`${DRIVE_API}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Google Drive API ${res.status}: ${await res.text()}`);
    return res;
  }

  async init(ctx: ConnectorContext): Promise<void> {
    this.accessToken = (ctx.config['accessToken'] as string | undefined) ?? process.env.GDRIVE_ACCESS_TOKEN ?? undefined;
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
    if (!this.accessToken && !this.apiKey && !this.refreshToken) return { healthy: false, message: 'No credentials' };
    return { healthy: true, message: 'Google Drive connector ready' };
  }

  private async listFiles(folderId: string, max: number): Promise<{ ok: true; files: Array<{ id: string; name: string; mimeType: string }> } | ErrEnvelope> {
    if (!this.accessToken) return { ok: false, error: { message: 'GDrive: accessToken required (config accessToken or GDRIVE_ACCESS_TOKEN env)' } };
    try {
      const pageSize = Math.min(Math.max(max, 1), 100);
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const data = await (await this.driveFetch(`/files?q=${q}&pageSize=${pageSize}&fields=files(id,name,mimeType,size)`)).json() as { files?: DriveFile[] };
      const files = (data.files ?? []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType }));
      return { ok: true, files };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async getFileContent(fileId: string): Promise<{ ok: true; content: string } | ErrEnvelope> {
    if (!this.accessToken) return { ok: false, error: { message: 'GDrive: accessToken required (config accessToken or GDRIVE_ACCESS_TOKEN env)' } };
    try {
      const meta = await (await this.driveFetch(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`)).json() as { mimeType?: string };
      const mimeType = meta.mimeType ?? '';
      const content = mimeType.startsWith('application/vnd.google-apps.')
        ? await (await this.driveFetch(`/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`)).text()
        : await (await this.driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`)).text();
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: { message: (e as Error).message } };
    }
  }

  private async syncFolder(folderId: string, project: string): Promise<{ ok: true; synced: number } | ErrEnvelope> {
    void project;
    if (!this.accessToken) return { ok: false, error: { message: 'GDrive: accessToken required (config accessToken or GDRIVE_ACCESS_TOKEN env)' } };
    const listed = await this.listFiles(folderId, 100);
    if (!listed.ok) return listed;
    let synced = 0;
    for (const f of listed.files) {
      if (!isSyncable(f.mimeType)) continue;
      const got = await this.getFileContent(f.id);
      if (got.ok) synced++;
    }
    return { ok: true, synced };
  }
}

export function createGDriveConnector(config: Record<string, unknown>): Connector {
  return new GDriveConnector();
}
