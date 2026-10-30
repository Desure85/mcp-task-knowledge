/**
 * web-ui/lib/auth.ts — Pure auth helpers shared by the shell, login page and
 * access page. No DOM or SDK imports so they stay trivially unit-testable.
 */

/** Fired on `window` when a stored token is rejected or has expired. */
export const AUTH_EXPIRED_EVENT = 'mcp:auth-expired';

export interface JwtClaims {
  sub?: string;
  roles: string[];
  exp?: number;
  iat?: number;
}

/**
 * Only same-origin, absolute-path redirects are honoured after login. Anything
 * else (`//evil.com`, `https://…`, `/\evil`, javascript:) falls back to `/` —
 * the `next` query param is attacker-controlled.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f]/.test(next)) return '/';
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return '/';
  return next;
}

/** Decode (NOT verify) a JWT payload for display. Returns null on any malformation. */
export function decodeJwtClaims(token: string | undefined | null): JwtClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? decodeURIComponent(
            Array.from(atob(padded))
              .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
              .join(''),
          )
        : Buffer.from(padded, 'base64').toString('utf-8');
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: typeof raw.sub === 'string' ? raw.sub : undefined,
      roles: Array.isArray(raw.roles) ? raw.roles.filter((r): r is string => typeof r === 'string') : [],
      exp: typeof raw.exp === 'number' ? raw.exp : undefined,
      iat: typeof raw.iat === 'number' ? raw.iat : undefined,
    };
  } catch {
    return null;
  }
}

/** True when the claims carry an `exp` that is already in the past. */
export function isExpired(claims: JwtClaims | null, nowMs: number = Date.now()): boolean {
  return Boolean(claims?.exp && claims.exp * 1000 <= nowMs);
}

/** Human-readable remaining lifetime: "29d 23h", "4h 12m", "35s", "expired". */
export function formatRemaining(expSeconds: number | undefined, nowMs: number = Date.now()): string {
  if (!expSeconds) return 'no expiry';
  const diff = Math.floor(expSeconds - nowMs / 1000);
  if (diff <= 0) return 'expired';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${diff}s`;
}

/** Does this error mean "you must (re)authenticate", as opposed to a normal tool failure? */
export function isAuthRequiredError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: unknown }).code;
  if (code === 401) return true;
  const message = (e as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    /\b401\b|authentication required|unauthori[sz]ed|mcp\.authenticate failed|token (expired|invalid)/i.test(message)
  );
}
