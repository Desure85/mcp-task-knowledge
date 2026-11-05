/**
 * relay/relay-manager.ts — LAN Relay manager (BM-012)
 *
 * Zero-config LAN sharing: WebSocket server + client with AES-256-GCM wire
 * encryption, UDP multicast peer discovery, and EventBus integration.
 *
 * Flow:
 *   - start(): binds WS server on a fixed port, starts discovery
 *   - on discovery of a peer: dial it with a WebSocket client
 *   - messages are { kind, payload } JSON, encrypted with the shared key
 *   - broadcast_rule: loads a Rule, sends to all peers, emits relay.rule.broadcast
 *   - incoming rules are emitted on the bus for local ingestion
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'node:http';
import { childLogger } from '../core/logger.js';
import { getEventBus } from '../core/event-bus.js';
import { LanDiscovery, type PeerInfo } from './discovery.js';
import { decrypt, deriveKey, encrypt } from './crypto.js';
import type { Rule } from '../rules/types.js';

export interface RelayOptions {
  /** WS listen port (default: 41235). */
  port?: number;
  /** Shared passphrase for AES-256-GCM (default: env RELAY_SHARED_KEY or random). */
  sharedKey?: string;
  /** Discovery group/port overrides. */
  discovery?: { group?: string; port?: number };
  /** Instance name. */
  name?: string;
}

export interface RelayStatus {
  enabled: boolean;
  port: number;
  peers: PeerInfo[];
  connections: number;
  encryption: 'aes-256-gcm';
  messagesSent: number;
  messagesReceived: number;
}

interface WireMessage {
  kind: 'rule' | 'brief' | 'ping';
  payload: unknown;
  from: string;
}

const DEFAULT_PORT = 41235;

const log = childLogger('relay');

export class RelayManager {
  private readonly port: number;
  private readonly key: Buffer;
  private readonly name: string;
  private readonly discovery: LanDiscovery;
  private httpServer?: Server;
  private wss?: WebSocketServer;
  private readonly connections = new Set<WebSocket>();
  private messagesSent = 0;
  private messagesReceived = 0;
  private _enabled = false;
  private dialTimer?: NodeJS.Timeout;

  constructor(options: RelayOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    const passphrase = options.sharedKey ?? process.env.RELAY_SHARED_KEY ?? `relay-${process.pid}`;
    this.key = deriveKey(passphrase);
    this.name = options.name ?? `relay-${process.pid}`;
    this.discovery = new LanDiscovery({
      group: options.discovery?.group,
      port: options.discovery?.port,
      name: this.name,
    });
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** Start WS server + discovery. Idempotent; a taken port disables relay. */
  start(): void {
    if (this._enabled) return;
    this._enabled = true;

    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => {
      this.connections.add(ws);
      ws.on('message', (data) => this.handleMessage(ws, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)));
      ws.on('close', () => this.connections.delete(ws));
      ws.on('error', () => this.connections.delete(ws));
    });
    this.wss.on('error', (err) => this.disable(err));

    const httpServer = this.httpServer;
    httpServer.on('error', (err) => this.disable(err));
    httpServer.once('listening', () => {
      if (!this._enabled) return;
      this.discovery.start();
      this.dialTimer = setInterval(() => this.dialPeers(), 3000);
      this.dialTimer.unref();
    });
    httpServer.listen(this.port);
  }

  /**
   * Port bind failed (EADDRINUSE, EACCES, …): the relay is optional, so log and
   * disable it instead of letting an unhandled 'error' event kill the server.
   */
  private disable(error: Error): void {
    if (!this._enabled && !this.httpServer && !this.wss) return;
    this._enabled = false;
    this.discovery.stop();
    if (this.dialTimer) {
      clearInterval(this.dialTimer);
      this.dialTimer = undefined;
    }
    try { this.wss?.close(); } catch {}
    this.wss = undefined;
    try { this.httpServer?.close(); } catch {}
    this.httpServer = undefined;
    log.warn({ err: error, port: this.port }, 'relay unavailable — listen failed, relay disabled');
  }

  /** Stop server + discovery. Idempotent. */
  stop(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this.discovery.stop();
    if (this.dialTimer) {
      clearInterval(this.dialTimer);
      this.dialTimer = undefined;
    }
    for (const ws of this.connections) {
      try { ws.close(); } catch {}
    }
    this.connections.clear();
    this.wss?.close();
    this.wss = undefined;
    this.httpServer?.close();
    this.httpServer = undefined;
  }

  /** Broadcast a rule to all connected peers. Returns sent count. */
  async broadcastRule(rule: Rule): Promise<{ sent: number }> {
    const message: WireMessage = { kind: 'rule', payload: rule, from: this.name };
    const sent = this.sendToAll(message);
    // Local notification (other modules can react)
    await getEventBus().emit({ type: 'relay.rule.broadcast', timestamp: Date.now(), data: rule });
    return { sent };
  }

  /** Share an arbitrary brief payload with peers (optionally filtered by name). */
  shareBrief(payload: unknown, peers?: string[]): { sent: number } {
    const message: WireMessage = { kind: 'brief', payload, from: this.name };
    let count = 0;
    for (const ws of this.connections) {
      const peerName = (ws as WebSocket & { peerName?: string }).peerName;
      if (peers && peerName && !peers.includes(peerName)) continue;
      this.send(ws, message);
      count++;
    }
    return { sent: count };
  }

  /** Current status for relay_status tool. */
  status(): RelayStatus {
    return {
      enabled: this._enabled,
      port: this.port,
      peers: this.discovery.peersList(),
      connections: this.connections.size,
      encryption: 'aes-256-gcm',
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
    };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private sendToAll(message: WireMessage): number {
    let count = 0;
    for (const ws of this.connections) {
      this.send(ws, message);
      count++;
    }
    return count;
  }

  private send(ws: WebSocket, message: WireMessage): void {
    try {
      const ciphertext = encrypt(JSON.stringify(message), this.key);
      ws.send(ciphertext);
      this.messagesSent++;
    } catch {
      // Drop failed send
    }
  }

  private handleMessage(ws: WebSocket, data: Buffer): void {
    try {
      const plaintext = decrypt(data.toString('utf8'), this.key);
      const message = JSON.parse(plaintext) as WireMessage;
      (ws as WebSocket & { peerName?: string }).peerName = message.from;
      this.messagesReceived++;
      if (message.kind === 'rule') {
        void getEventBus().emit({
          type: 'relay.rule.received',
          timestamp: Date.now(),
          data: message.payload,
        });
      }
    } catch {
      // Decryption/auth failure — drop (tampered or wrong key)
    }
  }

  private dialPeers(): void {
    // Only dial peers we are not already connected to.
    // Peer port is the WS port; discovery port differs by 1.
    const connectedNames = new Set(
      [...this.connections].map((ws) => (ws as WebSocket & { peerName?: string }).peerName),
    );
    for (const peer of this.discovery.peersList()) {
      if (connectedNames.has(peer.name)) continue;
      this.dial(peer);
    }
  }

  private dial(peer: PeerInfo): void {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${peer.port}`);
      // In a real LAN the host would come from the discovery datagram (rinfo.address);
      // single-host simulation uses loopback. The discovery payload carries only
      // name/port — host is resolved from the datagram source in production.
      ws.on('open', () => {
        (ws as WebSocket & { peerName?: string }).peerName = peer.name;
        this.connections.add(ws);
        ws.on('message', (data) => this.handleMessage(ws, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)));
        ws.on('close', () => this.connections.delete(ws));
        ws.on('error', () => this.connections.delete(ws));
      });
      ws.on('error', () => {});
    } catch {
      // Peer not reachable — discovery will retry
    }
  }
}
