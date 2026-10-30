/**
 * web-ui/components/Topbar.tsx — 56px top bar.
 *
 * Left: page title + muted subtitle (from the route).
 * Right: current project chip, realtime pill, auth indicator.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, clearAuthToken, hasAuthToken, hasStoredAuthToken } from '@/lib/api-client';
import { connectionBadgeClass, connectionBadgeLabel } from '@/lib/realtime';
import { pageMetaFor } from './nav-config';
import { useLiveStatus } from './live-status';
import { IconLock, IconProjects } from './icons';

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const meta = pageMetaFor(pathname);
  const live = useLiveStatus();

  const [project, setProject] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const [canSignOut, setCanSignOut] = useState(false);

  useEffect(() => {
    let alive = true;
    setHasToken(hasAuthToken());
    api.projects
      .list()
      .then((data) => {
        if (!alive) return;
        setProject(data.current ?? null);
        setProjects((data.projects ?? []).map((p) => p.id));
      })
      .catch(() => {
        if (alive) setProject(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setHasToken(hasAuthToken());
    setCanSignOut(hasStoredAuthToken());
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-neutral-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-[14px] font-semibold leading-tight tracking-tight text-neutral-900">
          {meta.title}
        </h1>
        <p className="truncate text-[11px] leading-tight text-neutral-500">{meta.subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <label className="hidden items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-600 sm:inline-flex">
          <IconProjects className="h-3.5 w-3.5 text-neutral-400" />
          <span className="text-neutral-400">Project</span>
          <select
            aria-label="Current project"
            value={project ?? ''}
            disabled={projects.length === 0}
            onChange={async (e) => {
              await api.projects.setCurrent(e.target.value);
              // Pages load their data client-side once; a reload re-fetches everything in the new scope.
              window.location.reload();
            }}
            className="max-w-[140px] cursor-pointer truncate bg-transparent font-medium text-neutral-700 outline-none"
          >
            {project && !projects.includes(project) && <option value={project}>{project}</option>}
            {projects.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        {live.status && (
          <span
            title={
              live.status === 'unavailable'
                ? 'Realtime server unreachable — polling fallback'
                : 'Realtime connection'
            }
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${connectionBadgeClass(live.status)}`}
          >
            {connectionBadgeLabel(live.status, live.presence)}
          </span>
        )}

        <Link
          href="/access"
          title={hasToken ? 'Signed in — manage access and tokens' : 'No API token set'}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50"
        >
          <IconLock className="h-3 w-3" />
          {hasToken ? 'Auth' : 'No auth'}
        </Link>
        {canSignOut && (
          <button
            type="button"
            onClick={() => {
              clearAuthToken();
              router.replace('/login');
            }}
            className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
