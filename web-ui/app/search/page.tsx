/**
 * web-ui/app/search/page.tsx — Unified search (UI-001)
 */

'use client';

import { useState } from 'react';
import { api, type SearchResult } from '@/lib/api-client';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [taskResults, setTaskResults] = useState<SearchResult[]>([]);
  const [kbResults, setKbResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const [tasks, kbs] = await Promise.all([
        api.search.tasks(query).catch(() => []),
        api.search.knowledge(query).catch(() => []),
      ]);
      setTaskResults(tasks);
      setKbResults(kbs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Search</h1>
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks and knowledge..."
          className="flex-1 px-4 py-2 border rounded"
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button onClick={search} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Search
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}

      {loading ? (
        <p className="text-gray-500">Searching...</p>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="font-semibold mb-3">Tasks ({taskResults.length})</h2>
            <div className="space-y-2">
              {taskResults.map((r) => (
                <div key={r.id} className="bg-white p-3 rounded border">
                  <p className="text-sm font-medium">{(r.item as { title?: string })?.title ?? r.id}</p>
                  <p className="text-xs text-gray-400">Score: {r.score.toFixed(3)}</p>
                </div>
              ))}
              {taskResults.length === 0 && query && <p className="text-sm text-gray-400">No results</p>}
            </div>
          </div>
          <div>
            <h2 className="font-semibold mb-3">Knowledge ({kbResults.length})</h2>
            <div className="space-y-2">
              {kbResults.map((r) => (
                <div key={r.id} className="bg-white p-3 rounded border">
                  <p className="text-sm font-medium">{(r.item as { title?: string })?.title ?? r.id}</p>
                  <p className="text-xs text-gray-400">Score: {r.score.toFixed(3)}</p>
                </div>
              ))}
              {kbResults.length === 0 && query && <p className="text-sm text-gray-400">No results</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
