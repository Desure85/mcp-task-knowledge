/**
 * web-ui/app/access/page.tsx — Access & tokens.
 *
 * Two jobs: show who you are signed in as (claims + your JWT for scripts),
 * and mint one-time setup links so another person's agent can configure
 * itself with a scoped token (admin_setup_link, admin role required).
 */

'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, resolveMcpApiUrl, resolveToken, type SetupLink } from '@/lib/api-client';
import { decodeJwtClaims, formatRemaining } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50"
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/**
 * Where agents should reach the server. The browser usually talks to MCP via
 * the Next proxy (/api/mcp), whose origin is useless to an agent — so only an
 * explicit NEXT_PUBLIC_MCP_PUBLIC_URL, or an absolute API URL on another
 * origin, is prefilled. Otherwise stay empty and let the server pick its own.
 */
function defaultPublicBase(): string {
  const explicit = process.env.NEXT_PUBLIC_MCP_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const url = resolveMcpApiUrl();
  if (!/^https?:\/\//.test(url)) return '';
  if (typeof window !== 'undefined' && url.startsWith(window.location.origin + '/')) return '';
  return url.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
}

export default function AccessPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | undefined>();
  const [showToken, setShowToken] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [project, setProject] = useState('');
  const [role, setRole] = useState('agent');
  const [ttlMin, setTtlMin] = useState(15);
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<SetupLink[]>([]);

  useEffect(() => {
    setToken(resolveToken());
    setBaseUrl(defaultPublicBase());
    api.projects
      .list()
      .then((d) => setProject(d.current ?? ''))
      .catch(() => undefined);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const claims = useMemo(() => decodeJwtClaims(token), [token]);

  async function onGenerate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await api.admin.setupLink({
        project: project.trim() || undefined,
        role: role.trim() || undefined,
        ttlMs: Math.min(60, Math.max(1, Math.round(ttlMin))) * 60_000,
        baseUrl: baseUrl.trim() || undefined,
      });
      setLinks((prev) => [link, ...prev].slice(0, 5));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await api.auth.logout();
    router.replace('/login');
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Access & tokens"
        description="Your session, and one-time links that let an agent configure itself."
        actions={
          token ? (
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Sign out
            </button>
          ) : undefined
        }
      />

      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-neutral-900">Your session</h3>
        {!token ? (
          <p className="mt-2 text-[13px] text-neutral-500">
            No token in this tab. The server is either open (no auth) or you are using a build-time token.
          </p>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-neutral-500">User</dt>
              <dd className="font-medium text-neutral-900">{claims?.sub ?? 'unknown'}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Roles</dt>
              <dd className="font-medium text-neutral-900">{claims?.roles.join(', ') || '—'}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Expires in</dt>
              <dd className="font-medium text-neutral-900">{formatRemaining(claims?.exp, now)}</dd>
            </div>
          </dl>
        )}
        {token && (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                {showToken ? 'Hide token' : 'Reveal token'}
              </button>
              <CopyButton text={token} label="Copy token" />
            </div>
            {showToken && (
              <code className="mt-2 block break-all rounded-lg bg-neutral-50 p-3 text-[11px] text-neutral-700">
                {token}
              </code>
            )}
            <p className="mt-2 text-[12px] text-neutral-500">
              This is your admin JWT — it grants the same access you have here. For an agent, prefer a scoped
              setup link below.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-neutral-900">Create agent setup link</h3>
        <p className="mt-1 text-[12px] text-neutral-500">
          The link works once and expires. It reveals the server URL and a token limited to the role and project
          below.
        </p>
        <form onSubmit={onGenerate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-700">Project</span>
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[13px] outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-700">Role</span>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[13px] outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-700">Link lifetime (minutes, 1–60)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={ttlMin}
              onChange={(e) => setTtlMin(Number(e.target.value) || 15)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[13px] outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-700">Public server URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://mcp.example.com"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[13px] outline-none focus:border-indigo-500"
            />
            <span className="mt-1 block text-[11px] text-neutral-500">
              Address the agent can reach. Leave empty for the server default (localhost) — set it when the agent
              runs on another machine.
            </span>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create link'}
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {/admin/i.test(error) ? 'Your account needs the admin role to create setup links.' : error}
          </p>
        )}

        {links.length > 0 && (
          <ul className="mt-5 space-y-3">
            {links.map((l) => (
              <li key={l.otp} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <code className="block break-all text-[12px] text-neutral-800">{l.url}</code>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-neutral-500">
                  <CopyButton text={l.url} label="Copy link" />
                  <span>project: {l.project}</span>
                  <span>role: {l.role}</span>
                  <span>expires {formatRemaining(Math.floor(new Date(l.expiresAt).getTime() / 1000), now)} from now</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
