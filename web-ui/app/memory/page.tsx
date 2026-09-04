'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  api,
  type TemporalFact,
  type TemporalStats,
  type MemoryFactMeta,
  type MemoryFactHit,
  type UserProfile,
  type LayeredFact,
  type MemoryLayerName,
} from '@/lib/api-client';

type Tab = 'facts' | 'temporal' | 'profiles' | 'layers';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'facts', label: 'Facts' },
  { id: 'temporal', label: 'Temporal History' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'layers', label: 'Layers' },
];

const LAYERS: MemoryLayerName[] = ['conversation', 'session', 'user'];

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
      <span>{message}</span>
      <button onClick={onDismiss} className="text-red-500">✕</button>
    </div>
  );
}

function FactCard({ fact }: { fact: TemporalFact }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">{fact.category}</span>
        <span className="text-xs text-gray-400">conf {fact.confidence}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${fact.valid ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {fact.valid ? 'valid' : 'invalidated'}
        </span>
      </div>
      <p className="font-medium">{fact.statement}</p>
      <p className="text-xs text-gray-400 mt-1 font-mono">{fact.id}</p>
      {fact.entities.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-2">
          {fact.entities.map((e) => (
            <span key={e} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{e}</span>
          ))}
        </div>
      )}
      <div className="text-xs text-gray-500 mt-2">
        validFrom {fact.validFrom}
        {fact.validTo && <span> → validTo {fact.validTo}</span>}
        {fact.invalidationReason && <span className="text-red-500"> ({fact.invalidationReason})</span>}
      </div>
    </div>
  );
}

function FactsTab() {
  const [facts, setFacts] = useState<MemoryFactMeta[]>([]);
  const [hits, setHits] = useState<MemoryFactHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.factsList({ limit: 100 });
      setFacts(Array.isArray(data.facts) ? data.facts : []);
      setHits(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function search() {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.factsSearch(q, { limit: 20 });
      setHits(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(() => {
    const c = category.trim().toLowerCase();
    if (!c) return facts;
    return facts.filter((f) => (f.tags ?? []).some((t) => t.toLowerCase().includes(c)));
  }, [facts, category]);

  return (
    <div>
      <div className="mb-4 flex gap-3 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
          placeholder="Search facts..."
          className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg"
        />
        <button
          onClick={() => void search()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Search
        </button>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Filter by category/tag..."
          className="px-3 py-2 border rounded-lg"
        />
        <button
          onClick={() => {
            setQuery('');
            setCategory('');
            void load();
          }}
          className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
        >
          Reset
        </button>
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : hits !== null ? (
        hits.length === 0 ? (
          <p className="text-gray-500">No facts match &ldquo;{query}&rdquo;.</p>
        ) : (
          <div className="space-y-3">
            {hits.map((h) => (
              <div key={h.id} className="bg-white rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">score {h.score}</span>
                  {(h.tags ?? []).map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{t}</span>
                  ))}
                </div>
                <p className="font-medium">{h.title}</p>
                <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{h.content}</p>
              </div>
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <p className="text-gray-500">No extracted facts yet. Run memory_extract first.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((f) => (
            <div key={f.id} className="bg-white rounded-lg border p-4">
              <p className="font-medium">{f.title}</p>
              <p className="text-xs text-gray-400 mt-1 font-mono">{f.id}</p>
              {(f.tags ?? []).length > 0 && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {(f.tags ?? []).map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-sm text-gray-500">Showing {visible.length} of {facts.length} facts</p>
        </div>
      )}
    </div>
  );
}

function TemporalTab() {
  const [stats, setStats] = useState<TemporalStats | null>(null);
  const [atTime, setAtTime] = useState('');
  const [entity, setEntity] = useState('');
  const [facts, setFacts] = useState<TemporalFact[]>([]);
  const [history, setHistory] = useState<TemporalFact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, q] = await Promise.all([
        api.memory.temporalStats(),
        api.memory.temporalQuery({ limit: 100 }),
      ]);
      setStats(s);
      setFacts(Array.isArray(q.facts) ? q.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function queryAt() {
    try {
      setLoading(true);
      setError(null);
      setHistory(null);
      const data = await api.memory.temporalQuery({
        atTime: atTime.trim() || undefined,
        entity: entity.trim() || undefined,
        includeInvalidated: true,
        limit: 100,
      });
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function showHistory(factId: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.temporalHistory(factId);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-xl font-bold">{stats.totalFacts}</p>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-400">Valid</p>
            <p className="text-xl font-bold text-green-600">{stats.validFacts}</p>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-400">Invalidated</p>
            <p className="text-xl font-bold text-gray-500">{stats.invalidatedFacts}</p>
          </div>
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs text-gray-400">Categories</p>
            <p className="text-xl font-bold">{Object.keys(stats.categories ?? {}).length}</p>
          </div>
        </div>
      )}
      <div className="mb-4 flex gap-3 flex-wrap">
        <input
          type="text"
          value={atTime}
          onChange={(e) => setAtTime(e.target.value)}
          placeholder="Point in time (ISO 8601, e.g. 2026-06-01T00:00:00Z)"
          className="flex-1 min-w-[240px] px-3 py-2 border rounded-lg font-mono text-sm"
        />
        <input
          type="text"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          placeholder="Entity filter..."
          className="px-3 py-2 border rounded-lg"
        />
        <button
          onClick={() => void queryAt()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Query
        </button>
        <button
          onClick={() => {
            setAtTime('');
            setEntity('');
            setHistory(null);
            void load();
          }}
          className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
        >
          Reset
        </button>
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {history !== null && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">History chain ({history.length})</h2>
            <button onClick={() => setHistory(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="space-y-2">
            {history.map((f) => (
              <FactCard key={f.id} fact={f} />
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : facts.length === 0 ? (
        <p className="text-gray-500">No temporal facts yet. Add some via memory_temporal_add first.</p>
      ) : (
        <div className="space-y-3">
          {facts.map((f) => (
            <div key={f.id} onClick={() => void showHistory(f.id)} className="cursor-pointer">
              <FactCard fact={f} />
            </div>
          ))}
          <p className="text-sm text-gray-500">{facts.length} fact(s) — click a fact to see its history chain</p>
        </div>
      )}
    </div>
  );
}

function ProfilesTab() {
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const id = userId.trim();
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      setContext(null);
      const p = await api.memory.profileGet(id);
      setProfile(p);
    } catch (e) {
      setProfile(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadContext() {
    const id = userId.trim();
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const c = await api.memory.profileContext(id);
      setContext(c.context);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const staticEntries = useMemo(() => Object.entries(profile?.static ?? {}), [profile]);

  return (
    <div>
      <div className="mb-4 flex gap-3 flex-wrap">
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
          placeholder="User ID..."
          className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg"
        />
        <button
          onClick={() => void load()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Load profile
        </button>
        <button
          onClick={() => void loadContext()}
          disabled={!profile}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
        >
          Context block
        </button>
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : !profile ? (
        <p className="text-gray-500">Enter a user ID to view their profile.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <h2 className="font-semibold mb-2">Static facts ({staticEntries.length})</h2>
            {staticEntries.length === 0 ? (
              <p className="text-sm text-gray-500">No static facts.</p>
            ) : (
              <dl className="space-y-1 text-sm">
                {staticEntries.map(([key, fact]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="text-gray-400 min-w-[120px]">{key}</dt>
                    <dd className="font-medium">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="bg-white rounded-lg border p-4">
            <h2 className="font-semibold mb-2">Dynamic facts ({profile.dynamic.length})</h2>
            {profile.dynamic.length === 0 ? (
              <p className="text-sm text-gray-500">No dynamic facts.</p>
            ) : (
              <div className="space-y-2">
                {profile.dynamic.map((f) => (
                  <div key={f.id} className="text-sm border-b pb-2 last:border-0">
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 mr-2">{f.category}</span>
                    <span className={f.valid ? '' : 'line-through text-gray-400'}>{f.statement}</span>
                    <p className="text-xs text-gray-400 mt-0.5">from {f.validFrom}{f.validTo ? ` → ${f.validTo}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {context !== null && (
        <div className="mt-4 bg-white rounded-lg border p-4">
          <h2 className="font-semibold mb-2">Context block (system-prompt injection)</h2>
          <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto whitespace-pre-wrap">{context}</pre>
        </div>
      )}
    </div>
  );
}

function LayersTab() {
  const [layer, setLayer] = useState<MemoryLayerName>('conversation');
  const [facts, setFacts] = useState<LayeredFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (l: MemoryLayerName) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.layerList(l);
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(layer);
  }, [layer, load]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {LAYERS.map((l) => (
          <button
            key={l}
            onClick={() => setLayer(l)}
            className={`px-4 py-2 rounded-lg transition ${layer === l ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
          >
            {l}
          </button>
        ))}
        <button
          onClick={() => void load(layer)}
          className="ml-auto px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
        >
          Reload
        </button>
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : facts.length === 0 ? (
        <p className="text-gray-500">No facts in layer &ldquo;{layer}&rdquo; yet.</p>
      ) : (
        <div className="space-y-3">
          {facts.map((f) => (
            <div key={f.id} className="bg-white rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">{f.category}</span>
                <span className="text-xs text-gray-400">conf {f.confidence}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${f.valid ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {f.valid ? 'valid' : 'invalid'}
                </span>
              </div>
              <p className="font-medium">{f.statement}</p>
              <p className="text-xs text-gray-400 mt-1 font-mono">{f.id} · {f.createdAt}</p>
              {f.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {f.tags.map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-sm text-gray-500">{facts.length} fact(s) in {layer} layer</p>
        </div>
      )}
    </div>
  );
}

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>('facts');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Memory Browser</h1>
      <div className="mb-4 flex gap-2 border-b pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-t-lg transition ${tab === t.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'facts' && <FactsTab />}
      {tab === 'temporal' && <TemporalTab />}
      {tab === 'profiles' && <ProfilesTab />}
      {tab === 'layers' && <LayersTab />}
    </div>
  );
}
