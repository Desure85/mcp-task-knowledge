/**
 * web-ui/app/prompts/page.tsx — Prompt management (UI-004, PH-015)
 *
 * Prompt catalog browsing (version/kind/status/domain), create with the
 * real prompt JSON contract, and A/B experiments (variants stats + bandit
 * next-pick) via shared SDK api-client.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface PromptItem {
  id: string;
  version: string;
  kind: string;
  status?: string;
  domain?: string;
  tags: string[];
  file?: string;
}

interface VariantStat {
  variant?: string;
  name?: string;
  impressions?: number;
  successes?: number;
  failures?: number;
  weight?: number;
  [k: string]: unknown;
}

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  review: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-gray-100 text-gray-600',
  deprecated: 'bg-red-100 text-red-600',
};

export default function PromptsPage() {
  const [items, setItems] = useState<PromptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<'prompts' | 'experiments'>('prompts');

  // create form — matches validatePromptMinimal contract server-side
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newTags, setNewTags] = useState('');

  // experiments tab
  const [promptKey, setPromptKey] = useState('');
  const [stats, setStats] = useState<VariantStat[] | null>(null);
  const [banditPick, setBanditPick] = useState<unknown>(null);
  const [expBusy, setExpBusy] = useState(false);

  const loadPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.prompts.list({ status: statusFilter || undefined });
      setItems(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  async function createPrompt() {
    const id = newId.trim();
    if (!id || !newTitle.trim() || !newDomain.trim() || !newTemplate.trim()) {
      setError('id, title, domain and template are required (prompt contract)');
      return;
    }
    try {
      setError(null);
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
      await api.prompts.bulkCreate([{
        type: 'prompt',
        id,
        version: '1.0.0',
        metadata: { title: newTitle.trim(), domain: newDomain.trim(), status: 'draft', kind: 'prompt', tags },
        template: newTemplate,
        variables: [],
      }]);
      setNewId(''); setNewTitle(''); setNewDomain(''); setNewTemplate(''); setNewTags('');
      setShowCreate(false);
      await loadPrompts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadExperiment() {
    const key = promptKey.trim();
    if (!key) return;
    try {
      setExpBusy(true);
      setError(null);
      const [st, pick] = await Promise.all([
        api.prompts.variantsStats(key).catch(() => null),
        api.prompts.banditNext(key).catch(() => null),
      ]);
      const statArr = Array.isArray(st) ? st
        : (st as { variants?: VariantStat[]; stats?: VariantStat[] } | null)?.variants
        ?? (st as { stats?: VariantStat[] } | null)?.stats
        ?? null;
      setStats(statArr);
      setBanditPick(pick);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExpBusy(false);
    }
  }

  const filtered = items.filter((p) =>
    !searchQuery || p.id.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Prompts <span className="text-sm font-normal text-gray-400">({total})</span></h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          + New Prompt
        </button>
      </div>

      <div className="mb-4 flex gap-2 border-b">
        {(['prompts', 'experiments'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            {t === 'prompts' ? 'Catalog' : 'A/B Experiments'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {showCreate && (
        <div className="mb-6 p-4 bg-white rounded-lg border space-y-3">
          <h2 className="font-semibold">New Prompt (v1.0.0, draft)</h2>
          <div className="grid grid-cols-2 gap-3">
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="id (e.g. review-assistant)" className="px-3 py-2 border rounded-lg" />
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="title" className="px-3 py-2 border rounded-lg" />
            <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="domain (e.g. code-review)" className="px-3 py-2 border rounded-lg" />
            <input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="tags, comma-separated" className="px-3 py-2 border rounded-lg" />
          </div>
          <textarea
            value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}
            placeholder="Template… Use {{variables}} for dynamic content"
            className="w-full h-40 px-4 py-3 border rounded-lg font-mono text-sm resize-none"
          />
          <div className="flex gap-2">
            <button onClick={createPrompt} className="px-4 py-2 bg-green-600 text-white rounded-lg">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'prompts' ? (
        <>
          <div className="mb-4 flex gap-2">
            <input
              type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by id…" className="flex-1 px-3 py-2 border rounded-lg"
            />
            <select
              value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">any status</option>
              <option value="draft">draft</option>
              <option value="review">review</option>
              <option value="published">published</option>
              <option value="deprecated">deprecated</option>
            </select>
          </div>
          {loading ? (
            <p className="text-gray-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-gray-500">No prompts found.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((p) => (
                <div key={`${p.id}@${p.version}`} className="bg-white p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="font-semibold">{p.id}</h2>
                    <span className="text-xs font-mono text-gray-400">v{p.version}</span>
                  </div>
                  <div className="flex gap-1 mb-2 flex-wrap">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{p.kind}</span>
                    {p.status && (
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGE[p.status] ?? 'bg-gray-100'}`}>{p.status}</span>
                    )}
                    {p.domain && <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded">{p.domain}</span>}
                    {(p.tags ?? []).map((tag) => (
                      <span key={tag} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{tag}</span>
                    ))}
                  </div>
                  {p.file && <p className="text-xs text-gray-400 font-mono truncate">{p.file}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div>
          <p className="text-gray-500 mb-4 text-sm">
            Bandit-based A/B experiments. Enter a promptKey to see variant stats and the next pick.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text" value={promptKey} onChange={(e) => setPromptKey(e.target.value)}
              placeholder="promptKey (e.g. review-assistant)" className="flex-1 px-3 py-2 border rounded-lg"
              onKeyDown={(e) => e.key === 'Enter' && loadExperiment()}
            />
            <button
              onClick={loadExperiment} disabled={expBusy || !promptKey.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
            >
              {expBusy ? 'Loading…' : 'Load'}
            </button>
          </div>
          {banditPick != null && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-sm text-green-800 font-medium">Bandit next pick: </span>
              <code className="text-xs">{JSON.stringify(banditPick)}</code>
            </div>
          )}
          {stats && (
            <div className="space-y-2">
              {stats.length === 0 && <p className="text-sm text-gray-400">No variants recorded for this key yet.</p>}
              {stats.map((v, i) => (
                <div key={v.variant ?? v.name ?? i} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{v.variant ?? v.name ?? `variant-${i}`}</p>
                    {v.weight != null && <p className="text-xs text-gray-500">Weight: {(v.weight * 100).toFixed(1)}%</p>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {v.impressions ?? 0} impressions / {v.successes ?? 0} wins / {v.failures ?? 0} fails
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
