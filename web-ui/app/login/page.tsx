/**
 * web-ui/app/login/page.tsx — Sign-in screen.
 *
 * Username/password → POST /auth/login → JWT stored for this tab. Redirects
 * to the sanitized `next` path. If the server needs no auth, says so and lets
 * the user in.
 */

'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, AuthError, hasStoredAuthToken } from '@/lib/api-client';
import { sanitizeNextPath } from '@/lib/auth';
import { BrandMark } from '@/components/BrandMark';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = sanitizeNextPath(params.get('next'));

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    if (hasStoredAuthToken()) router.replace(next);
  }, [router, next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(username.trim(), password);
      router.replace(next);
    } catch (err) {
      const ae = err instanceof AuthError ? err : null;
      if (ae?.code === 'LOGIN_DISABLED') setDisabled(true);
      setError(ae?.message ?? 'Sign-in failed.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size="md" />
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight text-neutral-900">Sign in</h1>
            <p className="text-[12px] text-neutral-500">MCP Task &amp; Knowledge</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-700">Username</span>
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy || disabled}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[14px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-neutral-50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-700">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || disabled}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[14px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-neutral-50"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </p>
          )}
          {disabled && (
            <p className="text-[12px] text-neutral-500">
              Set <code>MCP_LOGIN_USER</code>, <code>MCP_LOGIN_PASSWORD</code> and <code>JWT_SECRET</code> on the
              server, or paste a token on the System page.
            </p>
          )}

          <button
            type="submit"
            disabled={busy || disabled || !username.trim() || !password}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-[14px] font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
