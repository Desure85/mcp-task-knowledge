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
import { Button, Input } from '@/components/ui';

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
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-7">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size="md" />
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight text-ink">Sign in</h1>
            <p className="text-[12px] text-muted">MCP Task &amp; Knowledge</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Username"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy || disabled}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy || disabled}
          />

          {error && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-danger/40 bg-surface-2 px-3 py-2 text-[12px] text-danger">
              {error}
            </p>
          )}
          {disabled && (
            <p className="text-[12px] text-muted">
              Set <code>MCP_LOGIN_USER</code>, <code>MCP_LOGIN_PASSWORD</code> and <code>JWT_SECRET</code> on the
              server, or paste a token on the System page.
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={disabled || !username.trim() || !password}
            className="w-full"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
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
