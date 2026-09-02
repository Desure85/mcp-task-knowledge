/**
 * web-ui/app/prompts/page.tsx — Prompt management (UI-004)
 *
 * Prompt versioning, A/B testing, variant comparison, template editor.
 * Connects to MCP prompts_* tools.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

const MCP_API_URL = process.env.NEXT_PUBLIC_MCP_API_URL || '/api/mcp';

async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(MCP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: Date.now() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text ?? '{}';
  const env = JSON.parse(text) as { ok: boolean; data?: T; error?: { message: string } };
  if (!env.ok) throw new Error(env.error?.message ?? 'Unknown error');
  return env.data as T;
}

interface PromptVariant {
  id: string;
  name: string;
  content: string;
  weight?: number;
  metrics?: { impressions: number; successes: number; failures: number };
}

interface PromptExperiment {
  id: string;
  name: string;
  variants: PromptVariant[];
  status: 'running' | 'paused' | 'completed';
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; content: string; tags?: string[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState<{ id: string; name: string; content: string; tags?: string[] } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [experiments, setExperiments] = useState<PromptExperiment[]>([]);
  const [tab, setTab] = useState<'prompts' | 'experiments'>('prompts');

  const loadPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await callTool<Array<{ id: string; name: string; content: string; tags?: string[] }>>('prompts_list', {});
      setPrompts(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  async function createPrompt() {
    if (!editName.trim()) return;
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      await callTool('prompts_bulk_create', { items: [{ name: editName, content: editContent, tags }] });
      setEditName('');
      setEditContent('');
      setEditTags('');
      setShowCreate(false);
      await loadPrompts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startEdit(prompt: { id: string; name: string; content: string; tags?: string[] }) {
    setSelectedPrompt(prompt);
    setEditMode(true);
    setEditName(prompt.name);
    setEditContent(prompt.content);
    setEditTags((prompt.tags ?? []).join(', '));
  }

  function startCreate() {
    setSelectedPrompt(null);
    setEditMode(true);
    setShowCreate(true);
    setEditName('');
    setEditContent('');
    setEditTags('');
  }

  function cancelEdit() {
    setEditMode(false);
    setShowCreate(false);
    setSelectedPrompt(null);
  }

  const filtered = prompts.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Prompts</h1>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          + New Prompt
        </button>
      </div>

      <div className="mb-4 flex gap-2 border-b">
        <button
          onClick={() => setTab('prompts')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'prompts' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          Prompts
        </button>
        <button
          onClick={() => setTab('experiments')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'experiments' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          A/B Experiments
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {editMode ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selectedPrompt ? 'Edit Prompt' : 'New Prompt'}</h2>
            <div className="flex gap-2">
              <button onClick={cancelEdit} className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createPrompt} className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg">Save</button>
            </div>
          </div>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Prompt name..."
            className="w-full px-3 py-2 border rounded-lg text-lg font-medium"
            autoFocus
          />
          <input
            type="text"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="tags (comma-separated)"
            className="w-full px-3 py-2 border rounded-lg"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Prompt template... Use {{variables}} for dynamic content"
            className="w-full h-[400px] px-4 py-3 border rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      ) : tab === 'prompts' ? (
        <>
          <div className="mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompts..."
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-gray-500">No prompts found.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((prompt) => (
                <div
                  key={prompt.id}
                  className="bg-white p-4 rounded-lg border hover:shadow-md transition cursor-pointer"
                  onClick={() => startEdit(prompt)}
                >
                  <h2 className="font-semibold text-lg mb-1">{prompt.name}</h2>
                  {prompt.tags && prompt.tags.length > 0 && (
                    <div className="flex gap-1 mb-2 flex-wrap">
                      {prompt.tags.map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{tag}</span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-gray-600 line-clamp-3 font-mono">{prompt.content?.slice(0, 200)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div>
          <p className="text-gray-500 mb-4">A/B testing experiments with bandit-based variant selection.</p>
          {experiments.length === 0 ? (
            <div className="bg-white p-8 rounded-lg border text-center">
              <p className="text-gray-400 mb-4">No active experiments</p>
              <p className="text-sm text-gray-400">Create experiments via MCP tools: prompts_experiments_upsert, prompts_bandit_next, prompts_ab_report</p>
            </div>
          ) : (
            <div className="space-y-4">
              {experiments.map((exp) => (
                <div key={exp.id} className="bg-white p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">{exp.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      exp.status === 'running' ? 'bg-green-100 text-green-700' :
                      exp.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{exp.status}</span>
                  </div>
                  <div className="space-y-2">
                    {exp.variants.map((v) => (
                      <div key={v.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                        <div>
                          <p className="font-medium text-sm">{v.name}</p>
                          <p className="text-xs text-gray-500">Weight: {((v.weight ?? 0) * 100).toFixed(1)}%</p>
                        </div>
                        {v.metrics && (
                          <div className="text-xs text-gray-500">
                            {v.metrics.impressions} impressions / {v.metrics.successes} wins
                          </div>
                        )}
                      </div>
                    ))}
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
