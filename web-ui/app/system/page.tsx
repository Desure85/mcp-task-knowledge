/**
 * web-ui/app/system/page.tsx — System / ops surface (PH-015)
 *
 * Live MCP sessions (SessionManager), embeddings status, and a tools
 * catalog browser — the operational view of the server.
 */

'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  api,
  setAuthToken,
  clearAuthToken,
  hasAuthToken,
  type SessionListData,
  type EmbeddingsStatus,
  type ToolListEntry,
} from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
} from '@/components/ui';
import { IconAlert, IconSystem } from '@/components/icons';

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger"
    >
      <span className="flex items-start gap-2">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading system status">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <CardBody>
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default function SystemPage() {
  const [sessions, setSessions] = useState<SessionListData | null>(null);
  const [embeddings, setEmbeddings] = useState<EmbeddingsStatus | null>(null);
  const [tools, setTools] = useState<ToolListEntry[]>([]);
  const [toolsTotal, setToolsTotal] = useState(0);
  const [toolSearch, setToolSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [toolOffset, setToolOffset] = useState(0);
  const [sessionFilter, setSessionFilter] = useState('');
  const [sessionLimit, setSessionLimit] = useState(5);
  const [killTarget, setKillTarget] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);
  const TOOL_PAGE = 20;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [sess, emb, tl] = await Promise.all([
        api.system.sessionList().catch(() => null),
        api.system.embeddingsStatus().catch(() => null),
        api.system.toolsList(undefined, TOOL_PAGE, 0).catch(() => null),
      ]);
      setSessions(sess);
      setEmbeddings(emb);
      const entries = tl?.data ?? [];
      setTools(entries);
      setToolsTotal(tl?.pagination?.total ?? tl?.total ?? entries.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthed(hasAuthToken());
    void load();
  }, [load]);

  function saveToken() {
    const token = tokenInput.trim();
    if (!token) return;
    setAuthToken(token);
    setAuthed(true);
    setTokenInput('');
    void load();
  }

  function dropToken() {
    clearAuthToken();
    setAuthed(false);
    void load();
  }

  async function searchTools(offset = 0) {
    try {
      setError(null);
      const tl = await api.system.toolsList(toolSearch.trim() || undefined, TOOL_PAGE, offset);
      setTools(tl?.data ?? []);
      setToolsTotal(tl?.pagination?.total ?? tl?.total ?? (tl?.data?.length ?? 0));
      setToolOffset(offset);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmKill() {
    if (!killTarget) return;
    try {
      setKilling(true);
      setError(null);
      await api.system.sessionKill(killTarget);
      setKillTarget(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKilling(false);
    }
  }

  const visibleSessions = (sessions?.sessions ?? [])
    .filter((session) => {
      const q = sessionFilter.trim().toLowerCase();
      if (!q) return true;
      return [session.sessionId, session.remote, session.metadata?.userId, session.metadata?.currentProject]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(q));
    })
    .slice(0, sessionLimit);

  return (
    <div>
      <PageHeader
        title="System"
        description="Sessions, embeddings and the registered tool catalog."
        actions={<Button size="sm" onClick={() => void load()}>Refresh</Button>}
      />

      {error && (
        <Notice action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>
          {error}
        </Notice>
      )}

      {loading ? (
        <LoadingCards />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader><h2 className="text-[13px] font-semibold text-ink">Authentication</h2></CardHeader>
            <CardBody>
              <ol className="space-y-3 text-[12px] text-muted">
                <li className="flex gap-3">
                  <span aria-hidden="true" className="tnum text-[11px] font-semibold text-accent">1</span>
                  <span>
                    Get a personal token on the{' '}
                    <a href="/access" className="text-accent underline underline-offset-2 hover:text-accent-hover">
                      Access page
                    </a>
                    . Admin accounts can also manage users there.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="tnum text-[11px] font-semibold text-accent">2</span>
                  <span>
                    The token is kept in this tab&apos;s sessionStorage, never in a cookie; rotate it if you
                    suspect XSS.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden="true" className="tnum text-[11px] font-semibold text-accent">3</span>
                  <span className="min-w-0 flex-1">
                    {authed ? (
                      <span className="flex flex-wrap items-center gap-3">
                        <Badge tone="done">Token set for this session</Badge>
                        <Button size="sm" variant="danger" onClick={dropToken}>Clear token</Button>
                      </span>
                    ) : (
                      <span className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <span className="flex-1">
                          <Input
                            label="JWT token"
                            type="password"
                            value={tokenInput}
                            onChange={(e) => setTokenInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                            placeholder="Paste a token…"
                            autoComplete="off"
                          />
                        </span>
                        <Button variant="primary" onClick={saveToken} disabled={!tokenInput.trim()}>
                          Authenticate
                        </Button>
                      </span>
                    )}
                  </span>
                </li>
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink">Live sessions</h2>
              {sessions && (
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <Badge>{sessions.total} total</Badge>
                  {sessions.rateLimitingEnabled && <span>rate-limit on</span>}
                </div>
              )}
            </CardHeader>
            <CardBody>
              {!sessions || !sessions.available ? (
                <p className="text-[12px] text-muted">Session manager unavailable.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <Input
                        label="Filter sessions"
                        value={sessionFilter}
                        onChange={(e) => setSessionFilter(e.target.value)}
                        placeholder="Session, remote, user or project…"
                      />
                    </div>
                    <div className="w-28">
                      <Select label="Rows" value={sessionLimit} onChange={(e) => setSessionLimit(Number(e.target.value))}>
                        {[5, 10, 20].map((value) => <option key={value} value={value}>{value}</option>)}
                      </Select>
                    </div>
                  </div>
                  {visibleSessions.length === 0 ? (
                    <p className="text-[12px] text-muted">No active sessions besides this one.</p>
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto md:block">
                        <table className="w-full text-[12px]">
                          <caption className="sr-only">Active MCP sessions</caption>
                          <thead>
                            <tr className="border-b border-line text-left text-[11px] text-muted">
                              <th scope="col" className="pb-2 pr-4 font-medium">Session</th>
                              <th scope="col" className="pb-2 pr-4 font-medium">Remote</th>
                              <th scope="col" className="pb-2 pr-4 font-medium">User</th>
                              <th scope="col" className="pb-2 pr-4 font-medium">Project</th>
                              <th scope="col" className="pb-2 pr-4 font-medium">Last activity</th>
                              <th scope="col" className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleSessions.map((session) => (
                              <tr key={session.sessionId} className="border-b border-line last:border-0">
                                <td className="py-2 pr-4 font-mono text-[11px] text-ink" title={session.sessionId}>
                                  {session.sessionId.slice(0, 18)}…
                                </td>
                                <td className="py-2 pr-4 text-ink">{session.remote ?? '—'}</td>
                                <td className="py-2 pr-4 text-ink">{(session.metadata?.userId as string) ?? '—'}</td>
                                <td className="py-2 pr-4 text-ink">
                                  {(session.metadata?.currentProject as string) ?? '—'}
                                </td>
                                <td className="py-2 pr-4 font-mono text-[11px] text-muted">
                                  {session.lastActivityAt ? new Date(session.lastActivityAt).toLocaleTimeString() : '—'}
                                </td>
                                <td className="py-2 text-right">
                                  {sessions.selfSessionId !== session.sessionId && (
                                    <Button size="sm" variant="danger" onClick={() => setKillTarget(session.sessionId)}>
                                      Terminate
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ul className="divide-y divide-line md:hidden">
                        {visibleSessions.map((session) => (
                          <li key={session.sessionId} className="space-y-1 py-2 text-[12px]">
                            <div className="flex items-center justify-between gap-2">
                              <code className="font-mono text-[11px] text-ink">{session.sessionId.slice(0, 18)}…</code>
                              {sessions.selfSessionId !== session.sessionId && (
                                <Button size="sm" variant="danger" onClick={() => setKillTarget(session.sessionId)}>
                                  Terminate
                                </Button>
                              )}
                            </div>
                            <p className="text-muted">{session.remote ?? '—'} · {(session.metadata?.userId as string) ?? '—'}</p>
                            <p className="text-muted">project: {(session.metadata?.currentProject as string) ?? '—'}</p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><h2 className="text-[13px] font-semibold text-ink">Embeddings</h2></CardHeader>
            <CardBody>
              {embeddings ? (
                <dl className="grid gap-3 text-[12px] sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] text-muted">Mode</dt>
                    <dd className="font-mono text-ink">{String(embeddings.mode ?? 'unknown')}</dd>
                  </div>
                  {embeddings.dim != null && (
                    <div>
                      <dt className="text-[11px] text-muted">Dimensions</dt>
                      <dd className="font-mono text-ink">{String(embeddings.dim)}</dd>
                    </div>
                  )}
                  {embeddings.model != null && (
                    <div>
                      <dt className="text-[11px] text-muted">Model</dt>
                      <dd className="break-all font-mono text-ink">{String(embeddings.model)}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-[12px] text-muted">embeddings_status unavailable.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink">Tools catalog</h2>
              <Badge>{toolsTotal} registered</Badge>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Input
                    label="Filter tools"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void searchTools()}
                    placeholder="Filter tools by name…"
                  />
                </div>
                <Button onClick={() => void searchTools(0)}>Filter</Button>
              </div>
              <div
                className="mt-3 max-h-96 divide-y divide-line overflow-y-auto"
                role="region"
                aria-label="Tools list"
                tabIndex={0}
              >
                {tools.map((tool) => (
                  <div key={tool.name} className="flex items-baseline gap-3 py-2">
                    <code className="shrink-0 font-mono text-[11px] font-semibold text-accent">{tool.name}</code>
                    <span className="truncate text-[11px] text-muted">{tool.description ?? tool.title ?? ''}</span>
                  </div>
                ))}
                {tools.length === 0 && (
                  <div className="py-6">
                    <EmptyState compact title="No tools match" hint="Try another name." icon={IconSystem} />
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span className="tnum">
                  {tools.length === 0 ? 0 : toolOffset + 1}–{toolOffset + tools.length} of {toolsTotal}
                </span>
                <span className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void searchTools(Math.max(0, toolOffset - TOOL_PAGE))} disabled={toolOffset === 0}>
                    Previous
                  </Button>
                  <Button size="sm" onClick={() => void searchTools(toolOffset + TOOL_PAGE)} disabled={toolOffset + TOOL_PAGE >= toolsTotal}>
                    Next
                  </Button>
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <Dialog
        open={killTarget !== null}
        onClose={() => !killing && setKillTarget(null)}
        title="Terminate session?"
        description="The client will be disconnected immediately. This cannot be undone."
        destructive
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setKillTarget(null)} disabled={killing}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={() => void confirmKill()} loading={killing}>
              Terminate
            </Button>
          </div>
        }
      >
        <p className="font-mono text-[11px] text-muted">{killTarget}</p>
      </Dialog>
    </div>
  );
}
