/**
 * relay/discovery.ts — Zero-dep LAN peer discovery via UDP multicast (BM-012)
 *
 * Peers announce themselves with periodic heartbeat datagrams on a fixed
 * multicast group; each peer tracks the last-seen time of others and prunes
 * stale entries. No mDNS dependency — works on any LAN that supports
 * multicast (standard for home/office networks).
 *
 * Wire format: JSON { name, port, ts } — plaintext (presence only, not data).
 */

import dgram from 'node:dgram';

export interface PeerInfo {
  name: string;
  port: number;
  ts: number;
}

export interface DiscoveryOptions {
  /** Multicast group address (default: 239.255.42.99). */
  group?: string;
  /** UDP port for discovery (default: 41234). */
  port?: number;
  /** Heartbeat interval ms (default: 5000). */
  announceIntervalMs?: number;
  /** Peer considered stale after ms (default: 15000). */
  peerTtlMs?: number;
  /** Unique instance name (default: hostname). */
  name?: string;
}

const DEFAULT_GROUP = '239.255.42.99';
const DEFAULT_PORT = 41234;

export class LanDiscovery {
  private readonly group: string;
  private readonly port: number;
  private readonly announceIntervalMs: number;
  private readonly peerTtlMs: number;
  private readonly name: string;
  private socket?: dgram.Socket;
  private timer?: NodeJS.Timeout;
  private readonly peers = new Map<string, PeerInfo>();

  constructor(options: DiscoveryOptions = {}) {
    this.group = options.group ?? DEFAULT_GROUP;
    this.port = options.port ?? DEFAULT_PORT;
    this.announceIntervalMs = options.announceIntervalMs ?? 5000;
    this.peerTtlMs = options.peerTtlMs ?? 15000;
    this.name = options.name ?? `peer-${process.pid}`;
  }

  get peerCount(): number {
    this.pruneStale();
    return this.peers.size;
  }

  /** All currently-visible peers (keyed by name). */
  peersList(): PeerInfo[] {
    this.pruneStale();
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Start listening for peers and announce ourselves. */
  start(): void {
    if (this.socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString('utf8')) as PeerInfo;
        if (typeof data.name === 'string' && data.name !== this.name) {
          this.peers.set(data.name, { name: data.name, port: data.port, ts: data.ts });
        }
      } catch {
        // Ignore malformed datagrams
      }
    });

    socket.on('error', () => {
      // Non-fatal: discovery degrades to empty peer list
    });

    socket.bind(this.port, () => {
      socket.addMembership(this.group);
      this.socket = socket;
      this.announce();
      this.timer = setInterval(() => this.announce(), this.announceIntervalMs);
    });
  }

  /** Stop listening and clear peers. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.socket) {
      try {
        this.socket.dropMembership(this.group);
      } catch {
        // not joined yet — fine
      }
      this.socket.close();
      this.socket = undefined;
    }
    this.peers.clear();
  }

  private announce(): void {
    if (!this.socket) return;
    const payload: PeerInfo = { name: this.name, port: this.port, ts: Date.now() };
    const buf = Buffer.from(JSON.stringify(payload));
    this.socket.send(buf, this.port, this.group);
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [name, peer] of this.peers) {
      if (now - peer.ts > this.peerTtlMs) this.peers.delete(name);
    }
  }
}
