/**
 * relay/index.ts — LAN Relay module exports (BM-012).
 */

export { RelayManager } from './relay-manager.js';
export type { RelayOptions, RelayStatus } from './relay-manager.js';

export { LanDiscovery } from './discovery.js';
export type { PeerInfo, DiscoveryOptions } from './discovery.js';

export { deriveKey, encrypt, decrypt } from './crypto.js';
