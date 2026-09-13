/**
 * ssrf-guard.ts — SSRF protection for outbound webhook URLs (TR-28).
 *
 * Two layers:
 *  - checkWebhookUrl (sync): scheme allowlist + hostname/IP blocklist.
 *    Suitable for schema-level validation at submit time.
 *  - checkWebhookUrlResolved (async): additionally resolves the hostname via
 *    DNS and blocks if ANY resolved address is private. Use at fetch time —
 *    defends against DNS-rebinding where a public-looking hostname resolves
 *    to a private address.
 *
 * Env (read lazily per call so tests can set process.env):
 *  - WEBHOOK_ALLOWED_HOSTS: comma-separated exact hostnames that bypass the
 *    private-IP block (scheme rules still apply).
 *  - WEBHOOK_ALLOW_PRIVATE=1: dev escape hatch — disables private-IP blocking.
 */

import dns from 'node:dns';
import net from 'node:net';

export interface SsrfGuardOptions {
  /** Explicit allowlist of hostnames (exact match, case-insensitive). */
  allowedHosts?: string[];
  /** Allow private/loopback/link-local addresses. Default false. */
  allowPrivate?: boolean;
}

export type SsrfCheck = { ok: true; url: URL } | { ok: false; reason: string };

// ─── IPv4 helpers ────────────────────────────────────────────────────────────

/** Parse dotted-quad IPv4 to a 32-bit number. Returns null if not IPv4. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inCidr4(ipInt: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

const PRIVATE_V4: Array<[number, number]> = [
  [0x00000000, 8],   // 0.0.0.0/8 (incl. 0.0.0.0)
  [0x0a000000, 8],   // 10.0.0.0/8
  [0x64400000, 10],  // 100.64.0.0/10 CGNAT
  [0x7f000000, 8],   // 127.0.0.0/8 loopback
  [0xa9fe0000, 16],  // 169.254.0.0/16 link-local (cloud metadata)
  [0xac100000, 12],  // 172.16.0.0/12
  [0xc0a80000, 16],  // 192.168.0.0/16
];

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_V4.some(([base, prefix]) => inCidr4(n, base, prefix));
}

// ─── IPv6 helpers ────────────────────────────────────────────────────────────

/** Expand an IPv6 address (without brackets) to 8 hextets, or null. */
function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // IPv4-mapped / embedded tail: ::ffff:1.2.3.4
  const v4Match = s.match(/^(.*):(\d{1,3}(?:\.\d{1,3}){3})$/);
  let v4Tail: number[] | null = null;
  if (v4Match) {
    const n = ipv4ToInt(v4Match[2]);
    if (n === null) return null;
    v4Tail = [(n >>> 16) & 0xffff, n & 0xffff];
    s = v4Match[1];
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parseGroup = (g: string): number[] | null => {
    if (g === '') return [];
    const out: number[] = [];
    for (const h of g.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const left = parseGroup(halves[0]);
  if (left === null) return null;
  let right: number[] = [];
  if (halves.length === 2) {
    const r = parseGroup(halves[1]);
    if (r === null) return null;
    right = r;
  }
  const tailLen = v4Tail ? v4Tail.length : 0;
  const missing = 8 - left.length - right.length - tailLen;
  if (missing < 0) return null;
  if (halves.length === 1 && missing !== 0) return null; // no '::' must be full length
  const hextets = [...left, ...new Array<number>(missing).fill(0), ...right, ...(v4Tail ?? [])];
  return hextets.length === 8 ? hextets : null;
}

export function isPrivateIPv6(ip: string): boolean {
  const h = parseIPv6(ip);
  if (h === null) return false;
  const [a, b] = h;
  // ::1 loopback
  if (h.every((v, i) => v === (i === 7 ? 1 : 0))) return true;
  // :: unspecified
  if (h.every((v) => v === 0)) return true;
  // fc00::/7 ULA
  if ((a & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfe80) return true;
  // ::ffff:x.x.x.x IPv4-mapped — check embedded v4
  if (a === 0 && b === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const v4 = `${(h[6] >>> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >>> 8) & 0xff}.${h[7] & 0xff}`;
    return isPrivateIPv4(v4);
  }
  return false;
}

// ─── Hostname checks ─────────────────────────────────────────────────────────

function normalizeHostname(host: string): string {
  let h = host.toLowerCase();
  // Strip IPv6 brackets
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // Strip trailing dot (FQDN root)
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

function isLocalHostname(h: string): boolean {
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local');
}

/**
 * Defensive: if hostname is all-digits or 0x-prefixed after URL parsing,
 * treat as obfuscated IPv4. Node's URL parser already normalizes these to
 * dotted-quad, but guard anyway in case of parser differences.
 */
function isObfuscatedIPv4(h: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(h)) return true;
  if (/^\d+$/.test(h)) return true; // single integer form
  return false;
}

function hostIsPrivate(h: string): boolean {
  if (isLocalHostname(h)) return true;
  if (isObfuscatedIPv4(h)) return true;
  const ipVersion = net.isIP(h);
  if (ipVersion === 4) return isPrivateIPv4(h);
  if (ipVersion === 6) return isPrivateIPv6(h);
  return false;
}

// ─── Env config (lazy) ───────────────────────────────────────────────────────

function envAllowedHosts(): string[] {
  const raw = process.env.WEBHOOK_ALLOWED_HOSTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => normalizeHostname(s.trim()))
    .filter(Boolean);
}

function envAllowPrivate(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE === '1';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Synchronous SSRF check: parse URL, enforce scheme allowlist, block
 * private/loopback/link-local hosts unless allowed.
 */
export function checkWebhookUrl(raw: string, opts?: SsrfGuardOptions): SsrfCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `scheme '${url.protocol}' not allowed (http/https only)` };
  }

  const host = normalizeHostname(url.hostname);
  if (!host) {
    return { ok: false, reason: 'empty hostname' };
  }

  const allowPrivate = opts?.allowPrivate ?? envAllowPrivate();
  const allowed = new Set([...(opts?.allowedHosts ?? []), ...envAllowedHosts()].map(normalizeHostname));

  if (allowed.has(host)) {
    return { ok: true, url };
  }

  if (!allowPrivate && hostIsPrivate(host)) {
    return { ok: false, reason: `host '${host}' resolves to a private/reserved address` };
  }

  return { ok: true, url };
}

/**
 * Async SSRF check: sync rules + DNS resolution. Blocks if ANY resolved
 * address is private (DNS-rebinding defense). Use at fetch time.
 */
export async function checkWebhookUrlResolved(raw: string, opts?: SsrfGuardOptions): Promise<SsrfCheck> {
  const sync = checkWebhookUrl(raw, opts);
  if (!sync.ok) return sync;

  const host = normalizeHostname(sync.url.hostname);
  const allowPrivate = opts?.allowPrivate ?? envAllowPrivate();
  const allowed = new Set([...(opts?.allowedHosts ?? []), ...envAllowedHosts()].map(normalizeHostname));

  // Literal IPs and allowlisted hosts need no DNS check.
  if (net.isIP(host) !== 0 || allowed.has(host) || allowPrivate) {
    return sync;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed for '${host}': ${err instanceof Error ? err.message : String(err)}` };
  }

  for (const { address, family } of addresses) {
    const priv = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
    if (priv) {
      return { ok: false, reason: `host '${host}' resolves to private address ${address}` };
    }
  }

  return sync;
}
