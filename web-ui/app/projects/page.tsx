/**
 * web-ui/app/projects/page.tsx — Projects management (PH-015)
 *
 * Multi-project isolation: list, create, set-current (session-scoped per
 * PH-004), update description, delete (force) / purge (wipe all data) —
 * destructive ops guarded by explicit window.confirm.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type ProjectInfo } from '@/lib/api-client';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [current, setCurrent] = useState<{ project: string; scope?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, cur] = await Promise.all([
        api.projects.list(),
        api.projects.getCurrent().catch(() => null),
      ]);
      setProjects(list?.projects ?? []);
      setCurrent(cur);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createProject() {
    const id = newId.trim();
    if (!id) return;
    try {
      setBusy(true);
      await api.projects.create(id, newDesc.trim() || undefined);
      setNewId('');
      setNewDesc('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setAsCurrent(id: string) {
    try {
      setBusy(true);
      const res = await api.projects.setCurrent(id);
      setCurrent(res);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(id: string) {
    if (!window.confirm(`Delete project "${id}" and all its data? This cannot be undone.`)) return;
    try {
      setBusy(true);
      await api.projects.remove(id, true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function purgeProject(id: string) {
    if (!window.confirm(
      `PURGE "${id}"? Permanently deletes ALL tasks, knowledge and memory in this project. Type-confirm required.`,
    )) return;
    try {
      setBusy(true);
      await api.projects.purge(id, true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Projects</h1>
      <p className="text-sm text-gray-500 mb-6">
        Multi-project isolation. &quot;Current&quot; is scoped to this browser&apos;s MCP session —
        other sessions keep their own.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      <div className="mb-6 p-4 bg-white rounded-lg border flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">New project id</label>
          <input
            type="text" value={newId} onChange={(e) => setNewId(e.target.value)}
            placeholder="my-project" className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">Description (optional)</label>
          <input
            type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <button
          onClick={createProject} disabled={busy || !newId.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Create
        </button>
      </div>

      {current && (
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <span className="text-sm text-blue-800">
            Current: <b>{current.project}</b>
            {current.scope && <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 rounded">{current.scope}</span>}
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : projects.length === 0 ? (
        <p className="text-gray-500">No projects.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="bg-white p-4 rounded-lg border">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-lg">{p.id}</h2>
                <div className="flex gap-1">
                  {p.isDefault && <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">default</span>}
                  {p.isCurrent && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">current</span>}
                </div>
              </div>
              <div className="flex gap-3 text-xs text-gray-500 mb-3">
                <span>{p.hasTasks ? '✓ tasks' : '· no tasks'}</span>
                <span>{p.hasKnowledge ? '✓ knowledge' : '· no knowledge'}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {!p.isCurrent && (
                  <button
                    onClick={() => setAsCurrent(p.id)} disabled={busy}
                    className="text-sm px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Set as current (this session)
                  </button>
                )}
                {!p.isDefault && (
                  <>
                    <button
                      onClick={() => deleteProject(p.id)} disabled={busy}
                      className="text-sm px-3 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => purgeProject(p.id)} disabled={busy}
                      className="text-sm px-3 py-1 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      title="Permanently wipe all project data"
                    >
                      Purge
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
