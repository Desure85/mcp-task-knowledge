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
import { api, resolveMcpApiUrl, resolveToken, type AdminToken, type AdminUser, type SetupLink } from '@/lib/api-client';
import { decodeJwtClaims, formatRemaining } from '@/lib/auth';
import { checkSetupConnection, redeemSetupLink, type SetupCheck, type SetupSnippet } from '@/lib/setup-flow';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, Input } from '@/components/ui';

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
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? 'Copied' : label}
    </Button>
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

  // T-01c: users and personal tokens (admin role required by the server tools).
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userUsername, setUserUsername] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRoles, setUserRoles] = useState('agent');
  const [newPassword, setNewPassword] = useState('');
  const [editRoles, setEditRoles] = useState('');
  const [tokens, setTokens] = useState<AdminToken[]>([]);
  const [tokenName, setTokenName] = useState('personal');
  const [tokenExpiry, setTokenExpiry] = useState('');
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [snippet, setSnippet] = useState<SetupSnippet | null>(null);
  const [snippetOtp, setSnippetOtp] = useState<string | null>(null);
  const [snippetBusy, setSnippetBusy] = useState(false);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const [consumed, setConsumed] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<SetupCheck | null>(null);

  async function refreshUsers(): Promise<void> {
    try {
      setUsers(await api.admin.usersList());
      setUsersError(null);
    } catch (err) {
      setUsersError((err as Error).message);
    }
  }

  async function refreshTokens(userId: string): Promise<void> {
    setSelectedUser(userId);
    const user = users.find((candidate) => candidate.id === userId);
    if (user) setEditRoles(user.roles.join(', '));
    setRawToken(null);
    try {
      setTokens(await api.admin.tokensList(userId));
      setUsersError(null);
    } catch (err) {
      setUsersError((err as Error).message);
    }
  }

  useEffect(() => {
    setToken(resolveToken());
    setBaseUrl(defaultPublicBase());
    api.projects
      .list()
      .then((d) => setProject(d.current ?? ''))
      .catch(() => undefined);
    api.admin
      .usersList()
      .then((list) => {
        setUsers(list);
        setUsersError(null);
      })
      .catch((err: Error) => setUsersError(err.message));
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

  async function prepareSnippet(link: SetupLink): Promise<void> {
    setSnippetBusy(true);
    setSnippetError(null);
    setCheckResult(null);
    try {
      const next = await redeemSetupLink(link.url);
      setSnippet(next);
      setSnippetOtp(link.otp);
      setConsumed((prev) => (prev.includes(link.otp) ? prev : [...prev, link.otp]));
    } catch (err) {
      setSnippetError((err as Error).message);
    } finally {
      setSnippetBusy(false);
    }
  }

  async function checkConnection(): Promise<void> {
    if (!snippet) return;
    setChecking(true);
    setCheckResult(null);
    try {
      setCheckResult(await checkSetupConnection(snippet.token));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Access & tokens"
        description="Your session, and one-time links that let an agent configure itself."
        actions={
          token ? (
            <Button type="button" variant="secondary" onClick={signOut}>
              Sign out
            </Button>
          ) : undefined
        }
      />

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold text-ink">Your session</h3>
        {!token ? (
          <p className="mt-2 text-[13px] text-muted">
            No token in this tab. The server is either open (no auth) or you are using a build-time token.
          </p>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-muted">User</dt>
              <dd className="font-medium text-ink">{claims?.sub ?? 'unknown'}</dd>
            </div>
            <div>
              <dt className="text-muted">Roles</dt>
              <dd className="font-medium text-ink">{claims?.roles.join(', ') || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted">Expires in</dt>
              <dd className="font-medium text-ink">{formatRemaining(claims?.exp, now)}</dd>
            </div>
          </dl>
        )}
        {token && (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? 'Hide token' : 'Reveal token'}
              </Button>
              <CopyButton text={token} label="Copy token" />
            </div>
            {showToken && (
              <code className="mt-2 block break-all rounded-[var(--radius-control)] bg-surface-2 p-3 text-[11px] text-ink">
                {token}
              </code>
            )}
            <p className="mt-2 text-[12px] text-muted">
              This is your admin JWT — it grants the same access you have here. For an agent, prefer a scoped
              setup link below.
            </p>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold text-ink">1. Создайте одноразовую ссылку</h3>
        <ol className="mt-2 space-y-1 text-[12px] text-muted">
          <li>1. Создайте ссылку для агента.</li>
          <li>2. Откройте готовый конфиг (ссылка сработает один раз).</li>
          <li>3. Скопируйте сниппет в клиент агента.</li>
          <li>4. Нажмите «Проверить подключение».</li>
          <li>5. Передайте конфиг агенту.</li>
        </ol>
        <p className="mt-2 text-[12px] text-muted">
          Ссылка действует один раз. При открытии она показывает URL сервера и токен, ограниченный ролью и
          проектом ниже.
        </p>
        <form onSubmit={onGenerate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Project" value={project} onChange={(e) => setProject(e.target.value)} />
          <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} />
          <Input
            label="Ссылка действует (минут)"
            type="number"
            min={1}
            max={60}
            value={ttlMin}
            onChange={(e) => setTtlMin(Number(e.target.value) || 15)}
            hint="Одноразовая ссылка: от 1 до 60 минут. После получения конфига она больше не сработает."
          />
          <Input
            label="Public server URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://mcp.example.com"
            hint="Address the agent can reach. Leave empty for the server default (localhost) — set it when the agent runs on another machine."
          />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" loading={busy} disabled={busy}>
              {busy ? 'Создаём…' : 'Создать ссылку'}
            </Button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-4 rounded-[var(--radius-control)] border border-danger/40 bg-surface-2 px-3 py-2 text-[12px] text-danger">
            {/admin/i.test(error) ? 'Your account needs the admin role to create setup links.' : error}
          </p>
        )}

        {snippetError && (
          <p role="alert" className="mt-4 rounded-[var(--radius-control)] border border-danger/40 bg-surface-2 px-3 py-2 text-[12px] text-danger">
            {snippetError}
          </p>
        )}

        {links.length > 0 && (
          <ul className="mt-5 space-y-3">
            {links.map((l) => {
              const isUsed = consumed.includes(l.otp);
              return (
                <li key={l.otp} className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
                  <code className="block break-all text-[12px] text-ink">{l.url}</code>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted">
                    {!isUsed && <CopyButton text={l.url} label="Copy link" />}
                    {isUsed && <span>Ссылка использована для конфига</span>}
                    <span>project: {l.project}</span>
                    <span>role: {l.role}</span>
                    <span>expires {formatRemaining(Math.floor(new Date(l.expiresAt).getTime() / 1000), now)} from now</span>
                  </div>
                  {!isUsed && (
                    <div className="mt-2">
                      <Button type="button" variant="secondary" size="sm" loading={snippetBusy} onClick={() => void prepareSnippet(l)}>
                        2. Получить конфиг
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {snippet && (
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink">2–4. Конфиг агента</h3>
          <p className="mt-1 text-[12px] text-muted">
            Сниппет из ссылки {snippetOtp?.slice(0, 8)}… уже содержит URL и токен. Скопируйте его в конфиг
            клиента; токен показывается только здесь.
          </p>
          <pre className="mt-3 max-h-72 overflow-auto rounded-[var(--radius-control)] bg-surface-2 p-3 text-[11px] text-ink">
            <code>{snippet.configText}</code>
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <CopyButton text={snippet.configText} label="Copy config" />
            <span className="text-[12px] text-muted">server: {snippet.url ?? snippet.serverName}</span>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <h4 className="text-[13px] font-semibold text-ink">5. Проверьте подключение</h4>
            <p className="mt-1 text-[12px] text-muted">
              Отправим настоящий MCP <code>initialize</code> с этим токеном. Это не меняет проект.
            </p>
            <div className="mt-3">
              <Button type="button" variant="primary" size="sm" loading={checking} onClick={() => void checkConnection()}>
                Проверить подключение
              </Button>
            </div>
            {checkResult?.ok && (
              <p role="status" className="mt-3 rounded-[var(--radius-control)] border border-success/40 bg-surface-2 px-3 py-2 text-[12px] text-success">
                Подключение работает{checkResult.server ? ` — ${checkResult.server}` : ''}.
              </p>
            )}
            {checkResult && !checkResult.ok && (
              <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-danger/40 bg-surface-2 px-3 py-2 text-[12px] text-danger">
                Не удалось проверить подключение: {checkResult.error ?? 'неизвестная ошибка'}.
              </p>
            )}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-[14px] font-semibold text-ink">Users</h3>
        <p className="mt-1 text-[12px] text-muted">
          Users and roles live in <code>DATA_DIR/auth.db</code>. Passwords are hashed; changing one revokes that
          user&apos;s personal tokens.
        </p>
        {usersError && (
          <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-danger/40 bg-surface-2 px-3 py-2 text-[12px] text-danger">
            {/admin/i.test(usersError) ? 'Your account needs the admin role to manage users and tokens.' : usersError}
          </p>
        )}
        <form
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setAdminBusy(true);
            try {
              await api.admin.userCreate({
                username: userUsername,
                password: userPassword,
                roles: userRoles.split(',').map((role) => role.trim()).filter(Boolean),
              });
              setUserUsername('');
              setUserPassword('');
              await refreshUsers();
            } catch (err) {
              setUsersError((err as Error).message);
            } finally {
              setAdminBusy(false);
            }
          }}
        >
          <Input label="Username" value={userUsername} onChange={(e) => setUserUsername(e.target.value)} />
          <Input label="Password" type="password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
          <Input label="Roles (comma-separated)" value={userRoles} onChange={(e) => setUserRoles(e.target.value)} />
          <div className="sm:col-span-3">
            <Button type="submit" variant="primary" loading={adminBusy} disabled={adminBusy || !userUsername || !userPassword}>
              Create user
            </Button>
          </div>
        </form>

        <ul className="mt-5 divide-y divide-line">
          {users.map((user) => (
            <li key={user.id} className="flex min-h-[32px] flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{user.username}</span>
                <span className="text-muted">{user.roles.join(', ') || '—'}</span>
                {user.disabled && <span className="text-danger">disabled</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => void refreshTokens(user.id)}>
                  Tokens
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    setAdminBusy(true);
                    try {
                      await api.admin.userDisable({ userId: user.id, disabled: !user.disabled });
                      await refreshUsers();
                    } catch (err) {
                      setUsersError((err as Error).message);
                    } finally {
                      setAdminBusy(false);
                    }
                  }}
                >
                  {user.disabled ? 'Enable' : 'Disable'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {selectedUser && (
        <Card className="p-5">
          <h3 className="text-[14px] font-semibold text-ink">Personal tokens</h3>
          <p className="mt-1 text-[12px] text-muted">
            The raw token is shown once. Lists expose only the prefix; revoke a token to make it stop working
            immediately.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Input label="New password (optional)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                disabled={!newPassword || adminBusy}
                onClick={async () => {
                  setAdminBusy(true);
                  try {
                    await api.admin.userSetPassword({ userId: selectedUser, password: newPassword });
                    setNewPassword('');
                  } catch (err) {
                    setUsersError((err as Error).message);
                  } finally {
                    setAdminBusy(false);
                  }
                }}
              >
                Set password
              </Button>
            </div>
            <Input label="Token name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
            <Input label="Roles (selected user)" value={editRoles} onChange={(e) => setEditRoles(e.target.value)} />
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                disabled={adminBusy}
                onClick={async () => {
                  setAdminBusy(true);
                  try {
                    await api.admin.userSetRoles({
                      userId: selectedUser,
                      roles: editRoles.split(',').map((role) => role.trim()).filter(Boolean),
                    });
                    await refreshUsers();
                  } catch (err) {
                    setUsersError((err as Error).message);
                  } finally {
                    setAdminBusy(false);
                  }
                }}
              >
                Set roles
              </Button>
            </div>
            <Input label="Expires (optional)" type="datetime-local" value={tokenExpiry} onChange={(e) => setTokenExpiry(e.target.value)} />
            <div className="sm:col-span-4">
              <Button
                type="button"
                variant="primary"
                disabled={adminBusy}
                onClick={async () => {
                  setAdminBusy(true);
                  try {
                    const created = await api.admin.tokenCreate({
                      userId: selectedUser,
                      name: tokenName || undefined,
                      ...(tokenExpiry ? { expiresAt: new Date(tokenExpiry).toISOString() } : {}),
                    });
                    setRawToken(created.token);
                    await refreshTokens(selectedUser);
                  } catch (err) {
                    setUsersError((err as Error).message);
                  } finally {
                    setAdminBusy(false);
                  }
                }}
              >
                Create token
              </Button>
            </div>
          </div>

          {rawToken && (
            <div className="mt-4 rounded-[var(--radius-control)] border border-line bg-surface-2 p-3">
              <code className="block break-all text-[12px] text-ink">{rawToken}</code>
              <div className="mt-2">
                <CopyButton text={rawToken} label="Copy token" />
              </div>
            </div>
          )}

          <ul className="mt-5 divide-y divide-line">
            {tokens.map((item) => (
              <li key={item.id} className="flex min-h-[32px] flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2 text-muted">
                  <span className="font-medium text-ink">{item.name}</span>
                  <code className="text-[11px]">{item.prefix}…</code>
                  {item.revokedAt ? <span className="text-danger">revoked</span> : <span>active</span>}
                  {item.expiresAt && <span>expires {new Date(item.expiresAt).toLocaleString()}</span>}
                </div>
                {!item.revokedAt && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      setAdminBusy(true);
                      try {
                        await api.admin.tokenRevoke({ userId: selectedUser, tokenId: item.id });
                        await refreshTokens(selectedUser);
                      } catch (err) {
                        setUsersError((err as Error).message);
                      } finally {
                        setAdminBusy(false);
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
