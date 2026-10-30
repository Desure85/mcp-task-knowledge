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

type GateState = 'checking' | 'ready';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/login';
  const [gate, setGate] = useState<GateState>('checking');

  const toLogin = useCallback(() => {
    const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
    const next = here && here !== '/' && !here.startsWith('/login') ? `?next=${encodeURIComponent(here)}` : '';
    router.replace(`/login${next}`);
  }, [router]);

  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    (async () => {
      if (hasAuthToken() && isExpired(decodeJwtClaims(resolveToken()))) {
        clearAuthToken();
        if (alive) toLogin();
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
        else setGate('ready'); // server unreachable etc. — pages show their own errors
      }
    })();
    return () => {
      alive = false;
    };
  }, [isLogin, toLogin]);

  useEffect(() => {
    const onExpired = () => toLogin();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [toLogin]);

  if (isLogin) return <>{children}</>;

  return (
    <>
      <Sidebar />
      <div className="lg:pl-[248px]">
        <Topbar />
        <MobileNav />
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px]">
            {gate === 'ready' ? (
              children
            ) : (
              <p role="status" className="py-24 text-center text-[13px] text-neutral-500">
                Checking session…
              </p>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
