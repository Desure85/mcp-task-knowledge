/**
 * Stdio Transport Adapter
 *
 * Default transport for Claude Code, Windsurf, and direct pipe usage.
 * Reads JSON-RPC from stdin, writes responses to stdout.
 */

import { StdioServerTransport as SdkStdioTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { TransportConfig, TransportAdapter, TransportFactory, TransportHealth } from './types.js';
import type { ServerContext } from '../register/context.js';

// ─── Adapter ──────────────────────────────────────────────────────────

export class StdioTransportAdapter implements TransportAdapter {
  readonly type = 'stdio';
  private transport?: SdkStdioTransport;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  async connect(ctx: ServerContext): Promise<void> {
    if (this._connected) {
      throw new Error('[stdio] already connected');
    }

    this.transport = new SdkStdioTransport();
    await ctx.server.connect(this.transport);
    this._connected = true;
  }

  async close(): Promise<void> {
    if (!this._connected || !this.transport) {
      return;
    }

    try {
      await this.transport.close();
    } finally {
      this._connected = false;
      this.transport = undefined;
    }
  }

  health(): TransportHealth {
    // Stdio is always healthy — stdin/stdout are process-level pipes
    // that don't have a "listening" state to check.
    return {
      type: this.type,
      healthy: true,
      connected: this._connected,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export class StdioTransportFactory implements TransportFactory {
  readonly type = 'stdio';

  create(_config: TransportConfig): TransportAdapter {
    return new StdioTransportAdapter();
  }
}
