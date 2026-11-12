/** TR-30: egress policy for the web crawler. */
import { lookup } from 'node:dns/promises';

export class EgressError extends Error {
  constructor(readonly code: 'EGRESS_SCHEME' | 'EGRESS_PRIVATE' | 'EGRESS_CREDENTIALS' | 'EGRESS_HOST' | 'EGRESS_REDIRECT' | 'EGRESS_DNS', message: string) {
    super(message);
    this.name = 'EgressError';
  }
}

export interface EgressPolicy {
  /** Optional exact host allowlist; when set, anything else is rejected. */
  allowedHosts?: string[];
  allowPrivate?: boolean;
  maxRedirects?: number;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || a >= 224 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return false;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/** Validate a URL plus its DNS resolution; throws EgressError. */
export async function assertEgressAllowed(raw: string, policy: EgressPolicy = {}): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new EgressError('EGRESS_SCHEME', `invalid URL: ${raw}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new EgressError('EGRESS_SCHEME', `scheme not allowed: ${url.protocol}`);
  if (url.username || url.password) throw new EgressError('EGRESS_CREDENTIALS', 'credentials in URL are not allowed');
  const host = url.hostname.toLowerCase();
  if (policy.allowedHosts?.length && !policy.allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    throw new EgressError('EGRESS_HOST', `host not allowed: ${host}`);
  }
  if (policy.allowPrivate) return url;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new EgressError('EGRESS_PRIVATE', `private host not allowed: ${host}`);
  }
  if (isIpLiteral(host)) {
    if (isPrivateIpv4(host.replace(/^\[|\]$/g, '')) || isPrivateIpv6(host.replace(/^\[|\]$/g, ''))) {
      throw new EgressError('EGRESS_PRIVATE', `private address not allowed: ${host}`);
    }
    return url;
  }
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = await lookup(host, { all: true }); } catch { throw new EgressError('EGRESS_DNS', `cannot resolve: ${host}`); }
  if (addresses.length === 0) throw new EgressError('EGRESS_DNS', `cannot resolve: ${host}`);
  for (const a of addresses) {
    if ((a.family === 4 && isPrivateIpv4(a.address)) || (a.family === 6 && isPrivateIpv6(a.address))) {
      throw new EgressError('EGRESS_PRIVATE', `host resolves to private address: ${host}`);
    }
  }
  return url;
}

export interface SafeFetchResult { url: string; status: number; text: string }

/** Fetch with scheme/host/private-IP checks on the start URL and every redirect. */
export async function safeFetchText(raw: string, options: EgressPolicy & { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = (await assertEgressAllowed(raw, options)).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const resp = await fetchImpl(current, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      redirect: 'manual',
      headers: { 'User-Agent': 'mcp-task-knowledge-crawler/1.0' },
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) throw new EgressError('EGRESS_REDIRECT', `redirect without Location from ${current}`);
      current = (await assertEgressAllowed(new URL(location, current).toString(), options)).toString();
      continue;
    }
    return { url: current, status: resp.status, text: await resp.text() };
  }
  throw new EgressError('EGRESS_REDIRECT', `too many redirects (>${maxRedirects})`);
}
