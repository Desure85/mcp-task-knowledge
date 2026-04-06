/**
 * Stdio Transport Adapter
 *
 * Default transport for Claude Code, Windsurf, and direct pipe usage.
 * Reads JSON-RPC from stdin, writes responses to stdout.
 */

import { StdioServerTransport as SdkStdioTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { TransportConfig, TransportAdapter, TransportFactory } from './types.js';
import type { ServerContext } from '../register/context.js';

// ─── Adapter ──────────────────────────────────────────────────────────

export class StdioTransportAdapter implements TransportAdapter {
  readonly type = 'stdio';
  private transport?: SdkStdioTransport;
  private connected = false;

  async connect(ctx: ServerContext): Promise<void> {
    if (this.connected) {
      throw new Error('[stdio] already connected');
    }

    this.transport = new SdkStdioTransport();
    await ctx.server.connect(this.transport);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected || !this.transport) {
      return;
    }

    try {
      await this.transport.close();
    } finally {
      this.connected = false;
      this.transport = undefined;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export class StdioTransportFactory implements TransportFactory {
  readonly type = 'stdio';

  create(_config: TransportConfig): TransportAdapter {
    return new StdioTransportAdapter();
  }
}
