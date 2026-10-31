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
  EmptyState,
  Input,
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

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [sess, emb, tl] = await Promise.all([
        api.system.sessionList().catch(() => null),
        api.system.embeddingsStatus().catch(() => null),
        api.system.toolsList().catch(() => null),
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

  async function searchTools() {
    try {
      setError(null);
      const tl = await api.system.toolsList(toolSearch.trim() || undefined);
      setTools(tl?.data ?? []);
      setToolsTotal(tl?.pagination?.total ?? tl?.total ?? (tl?.data?.length ?? 0));
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
            <CardBody className="space-y-3">
              <p className="text-[12px] text-muted">
                When the server enforces JWT auth, tools beyond initialize/tools_list/ping need an
                authenticated session. The token is kept in sessionStorage for this tab only and is
                never sent as a cookie, so cross-site requests cannot ride an ambient session.
              </p>
              <p className="text-[12px] text-muted">
                Trade-off: any XSS in this origin could read the token. Keep Markdown sanitised and
                rotate tokens on suspicion.
              </p>
              {authed ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="done">Token set for this session</Badge>
                  <Button size="sm" variant="danger" onClick={dropToken}>Clear token</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Input
                      label="JWT token"
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                      placeholder="Paste a token…"
                      autoComplete="off"
                    />
                  </div>
                  <Button variant="primary" onClick={saveToken} disabled={!tokenInput.trim()}>
                    Authenticate
                  </Button>
                </div>
              )}
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
              ) : sessions.sessions.length === 0 ? (
                <p className="text-[12px] text-muted">No active sessions besides this one.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <caption className="sr-only">Active MCP sessions</caption>
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] text-muted">
                        <th scope="col" className="pb-2 pr-4 font-medium">Session</th>
                        <th scope="col" className="pb-2 pr-4 font-medium">Remote</th>
                        <th scope="col" className="pb-2 pr-4 font-medium">User</th>
                        <th scope="col" className="pb-2 pr-4 font-medium">Project</th>
                        <th scope="col" className="pb-2 font-medium">Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.sessions.map((session) => (
                        <tr key={session.sessionId} className="border-b border-line last:border-0">
                          <td className="py-2 pr-4 font-mono text-[11px] text-ink" title={session.sessionId}>
                            {session.sessionId.slice(0, 18)}…
                          </td>
                          <td className="py-2 pr-4 text-ink">{session.remote ?? '—'}</td>
                          <td className="py-2 pr-4 text-ink">{(session.metadata?.userId as string) ?? '—'}</td>
                          <td className="py-2 pr-4 text-ink">
                            {(session.metadata?.currentProject as string) ?? '—'}
                          </td>
                          <td className="py-2 font-mono text-[11px] text-muted">
                            {session.lastActivityAt ? new Date(session.lastActivityAt).toLocaleTimeString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                <Button onClick={() => void searchTools()}>Filter</Button>
              </div>
              <div className="mt-3 max-h-96 divide-y divide-line overflow-y-auto">
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
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
