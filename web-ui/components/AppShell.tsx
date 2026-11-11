/**
 * web-ui/components/AppShell.tsx — Shell + route guard.
 *
 * `/login` renders bare (no sidebar/topbar). Every other route is guarded:
 *   - a stored/env token that is already expired is dropped,
 *   - with no token we probe the server once: an open server (stdio/local
 *     dev, auth off) just renders, an auth-protected one sends the user to
 *     /login?next=<current path>,
 *   - a later `mcp:auth-expired` event (rejected token) does the same.
 */

'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, clearAuthToken, hasAuthToken, resolveToken } from '@/lib/api-client';
import { AUTH_EXPIRED_EVENT, decodeJwtClaims, isAuthRequiredError, isExpired } from '@/lib/auth';
import { MobileNav, Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ThemeSync } from './ThemeSync';
import { Button } from './ui';

type GateState = 'checking' | 'ready' | 'error';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/login';
  const [gate, setGate] = useState<GateState>('checking');
  const [probeNonce, setProbeNonce] = useState(0);

  const toLogin = useCallback((expired = false) => {
    const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
    const params = new URLSearchParams();
    if (here && here !== '/' && !here.startsWith('/login')) params.set('next', here);
    if (expired) params.set('expired', '1');
    const query = params.toString();
    router.replace(`/login${query ? `?${query}` : ''}`);
  }, [router]);

  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    setGate('checking');
    (async () => {
      if (hasAuthToken() && isExpired(decodeJwtClaims(resolveToken()))) {
        clearAuthToken();
        if (alive) toLogin(true);
        return;
      }
      if (hasAuthToken()) {
        if (alive) setGate('ready');
        return;
      }
      try {
        await api.projects.list();
        if (alive) setGate('ready');
      } catch (e) {
        if (!alive) return;
        if (isAuthRequiredError(e)) toLogin();
        // UI-12: error wins over empty. A page must not render its empty state
        // while the API is unreachable — show one shell-level retry instead.
        else setGate('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [isLogin, toLogin, probeNonce]);

  useEffect(() => {
    const onExpired = () => {
      // The shell may already be on its way to /login?next=…; a second API
      // failure from the topbar must not replace that query with expired-only.
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/login')) return;
      toLogin(true);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [toLogin]);

  if (isLogin) return <>{children}</>;

  return (
    <>
      <a
        href="#main-content"
        className="sr-only rounded-[var(--radius-control)] bg-accent px-3 py-2 text-[13px] text-on-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="lg:pl-[var(--spacing-nav)]">
        <Topbar />
        <MobileNav />
        {gate === 'ready' && <ThemeSync />}
        <main id="main-content" tabIndex={-1} className="px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            {gate === 'ready' ? (
              children
            ) : gate === 'error' ? (
              <div role="alert" className="mx-auto max-w-xl py-16 text-center">
                <h2 className="text-[20px] font-semibold text-ink">Server unavailable</h2>
                <p className="mt-2 text-[13px] text-muted">
                  The MCP server did not answer. Your data is safe — retry when it is back.
                </p>
                <Button className="mt-6" variant="primary" onClick={() => setProbeNonce((value) => value + 1)}>
                  Retry
                </Button>
              </div>
            ) : (
              <p role="status" className="py-24 text-center text-[13px] text-muted">
                Checking session…
              </p>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
