/**
 * web-ui/app/system/page.tsx — System / ops surface (PH-015)
 *
 * Live MCP sessions (SessionManager), embeddings status, and a tools
 * catalog browser — the operational view of the server.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  api,
  setAuthToken,
  clearAuthToken,
  hasAuthToken,
  type SessionListData,
  type EmbeddingsStatus,
  type ToolListEntry,
} from '@/lib/api-client';

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
    const t = tokenInput.trim();
    if (!t) return;
    setAuthToken(t);
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
      const tl = await api.system.toolsList(toolSearch.trim() || undefined);
      setTools(tl?.data ?? []);
      setToolsTotal(tl?.pagination?.total ?? tl?.total ?? (tl?.data?.length ?? 0));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">System</h1>
        <button onClick={() => void load()} className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-6">
          {/* Auth (SEC-003) */}
          <section className="bg-white p-5 rounded-lg border">
            <h2 className="font-semibold mb-3">Authentication</h2>
            <p className="text-xs text-gray-500 mb-3">
              When the server enforces JWT auth, tools beyond initialize/tools_list/ping require an
              authenticated session. The token is kept in sessionStorage for this tab only.
            </p>
            {authed ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-green-700 font-medium">Token set for this session</span>
                <button onClick={dropToken} className="px-3 py-1 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                  Clear token
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="JWT token…" className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono"
                  onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                />
                <button
                  onClick={saveToken} disabled={!tokenInput.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Authenticate
                </button>
              </div>
            )}
          </section>

          {/* Sessions */}
          <section className="bg-white p-5 rounded-lg border">
            <h2 className="font-semibold mb-3">
              Live Sessions
              {sessions && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  total: {sessions.total}
                  {sessions.rateLimitingEnabled ? ' · rate-limit on' : ''}
                </span>
              )}
            </h2>
            {!sessions || !sessions.available ? (
              <p className="text-sm text-gray-400">Session manager unavailable.</p>
            ) : sessions.sessions.length === 0 ? (
              <p className="text-sm text-gray-400">No active sessions besides this one.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="pb-2 pr-4">Session</th>
                      <th className="pb-2 pr-4">Remote</th>
                      <th className="pb-2 pr-4">User</th>
                      <th className="pb-2 pr-4">Project</th>
                      <th className="pb-2">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.sessions.map((s) => (
                      <tr key={s.sessionId} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{s.sessionId.slice(0, 18)}…</td>
                        <td className="py-2 pr-4">{s.remote ?? '—'}</td>
                        <td className="py-2 pr-4">{(s.metadata?.userId as string) ?? '—'}</td>
                        <td className="py-2 pr-4">{(s.metadata?.currentProject as string) ?? '—'}</td>
                        <td className="py-2 text-xs text-gray-500">
                          {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleTimeString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Embeddings */}
          <section className="bg-white p-5 rounded-lg border">
            <h2 className="font-semibold mb-3">Embeddings</h2>
            {embeddings ? (
              <div className="flex gap-6 text-sm">
                <div><span className="text-gray-500">Mode:</span> <b>{String(embeddings.mode ?? 'unknown')}</b></div>
                {embeddings.dim != null && <div><span className="text-gray-500">Dim:</span> {String(embeddings.dim)}</div>}
                {embeddings.model != null && <div><span className="text-gray-500">Model:</span> {String(embeddings.model)}</div>}
              </div>
            ) : (
              <p className="text-sm text-gray-400">embeddings_status unavailable.</p>
            )}
          </section>

          {/* Tools catalog */}
          <section className="bg-white p-5 rounded-lg border">
            <h2 className="font-semibold mb-3">Tools Catalog <span className="text-xs font-normal text-gray-500">({toolsTotal} registered)</span></h2>
            <div className="flex gap-2 mb-3">
              <input
                type="text" value={toolSearch} onChange={(e) => setToolSearch(e.target.value)}
                placeholder="Filter tools by name…" className="flex-1 px-3 py-2 border rounded-lg text-sm"
                onKeyDown={(e) => e.key === 'Enter' && searchTools()}
              />
              <button onClick={searchTools} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                Filter
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto space-y-1">
              {tools.map((t) => (
                <div key={t.name} className="flex items-baseline gap-3 py-1 border-b last:border-0">
                  <code className="text-xs font-semibold text-blue-700 shrink-0">{t.name}</code>
                  <span className="text-xs text-gray-500 truncate">{t.description ?? t.title ?? ''}</span>
                </div>
              ))}
              {tools.length === 0 && <p className="text-sm text-gray-400">No tools match.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
