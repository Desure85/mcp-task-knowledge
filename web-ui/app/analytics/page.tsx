/**
 * web-ui/app/analytics/page.tsx — Feedback loop & analytics (UI-006)
 *
 * Usage tracking (anonymous), feedback forms, analytics dashboard.
 * Shows task stats, knowledge stats, search stats, memory stats.
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

interface FeedbackEntry {
  id: string;
  target: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

interface Stats {
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  tasksByPriority: Record<string, number>;
  totalKnowledge: number;
  totalSearches: number;
  avgSearchScore?: number;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [localFeedback, setLocalFeedback] = useState<FeedbackEntry[]>([]);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const tasks = await callTool<Array<{ status: string; priority: string }>>('tasks_list', {});
      const taskArr = Array.isArray(tasks) ? tasks : [];
      const tasksByStatus: Record<string, number> = {};
      const tasksByPriority: Record<string, number> = {};
      for (const t of taskArr) {
        tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
        tasksByPriority[t.priority] = (tasksByPriority[t.priority] ?? 0) + 1;
      }

      let totalKnowledge = 0;
      try {
        const docs = await callTool<unknown[]>('knowledge_list', {});
        totalKnowledge = Array.isArray(docs) ? docs.length : 0;
      } catch { }

      setStats({
        totalTasks: taskArr.length,
        tasksByStatus,
        tasksByPriority,
        totalKnowledge,
        totalSearches: 0,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    const stored = localStorage.getItem('mcp-feedback');
    if (stored) {
      try { setLocalFeedback(JSON.parse(stored)); } catch { }
    }
  }, [loadStats]);

  function submitFeedback() {
    const entry: FeedbackEntry = {
      id: `fb_${Date.now()}`,
      target: feedbackTarget || 'general',
      rating: feedbackRating,
      comment: feedbackComment,
      createdAt: new Date().toISOString(),
    };
    const updated = [entry, ...localFeedback].slice(0, 50);
    setLocalFeedback(updated);
    localStorage.setItem('mcp-feedback', JSON.stringify(updated));
    setFeedbackTarget('');
    setFeedbackRating(5);
    setFeedbackComment('');
    setShowFeedbackForm(false);
    setFeedback(updated);
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-400',
    in_progress: 'bg-blue-500',
    completed: 'bg-green-500',
    closed: 'bg-gray-300',
  };

  const priorityColors: Record<string, string> = {
    high: 'bg-red-500',
    medium: 'bg-yellow-500',
    low: 'bg-gray-400',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <button
          onClick={() => setShowFeedbackForm(!showFeedbackForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Give Feedback
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {showFeedbackForm && (
        <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border space-y-3">
          <h3 className="font-semibold">Share Feedback</h3>
          <input
            type="text"
            value={feedbackTarget}
            onChange={(e) => setFeedbackTarget(e.target.value)}
            placeholder="What is this about? (feature name, page, etc.)"
            className="w-full px-3 py-2 border rounded-lg"
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Rating:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setFeedbackRating(n)}
                className={`w-8 h-8 rounded-full border ${feedbackRating >= n ? 'bg-yellow-400 border-yellow-400' : 'bg-white'}`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            value={feedbackComment}
            onChange={(e) => setFeedbackComment(e.target.value)}
            placeholder="Comments (optional)..."
            className="w-full px-3 py-2 border rounded-lg h-24 resize-none"
          />
          <button onClick={submitFeedback} className="px-4 py-2 bg-green-600 text-white rounded-lg">Submit</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : stats ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-6 rounded-lg border">
              <p className="text-sm text-gray-500">Total Tasks</p>
              <p className="text-3xl font-bold">{stats.totalTasks}</p>
            </div>
            <div className="bg-white p-6 rounded-lg border">
              <p className="text-sm text-gray-500">Knowledge Docs</p>
              <p className="text-3xl font-bold">{stats.totalKnowledge}</p>
            </div>
            <div className="bg-white p-6 rounded-lg border">
              <p className="text-sm text-gray-500">Feedback Entries</p>
              <p className="text-3xl font-bold">{localFeedback.length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg border">
              <h2 className="font-semibold mb-4">Tasks by Status</h2>
              <div className="space-y-2">
                {Object.entries(stats.tasksByStatus).map(([status, count]) => {
                  const pct = stats.totalTasks > 0 ? (count / stats.totalTasks) * 100 : 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className="text-sm w-24 capitalize">{status.replace('_', ' ')}</span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${statusColors[status] ?? 'bg-gray-400'} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{count}</span>
                    </div>
                  );
                })}
                {Object.keys(stats.tasksByStatus).length === 0 && (
                  <p className="text-sm text-gray-400">No tasks</p>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg border">
              <h2 className="font-semibold mb-4">Tasks by Priority</h2>
              <div className="space-y-2">
                {Object.entries(stats.tasksByPriority).map(([priority, count]) => {
                  const pct = stats.totalTasks > 0 ? (count / stats.totalTasks) * 100 : 0;
                  return (
                    <div key={priority} className="flex items-center gap-3">
                      <span className="text-sm w-24 capitalize">{priority}</span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${priorityColors[priority] ?? 'bg-gray-400'} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{count}</span>
                    </div>
                  );
                })}
                {Object.keys(stats.tasksByPriority).length === 0 && (
                  <p className="text-sm text-gray-400">No tasks</p>
                )}
              </div>
            </div>
          </div>

          {localFeedback.length > 0 && (
            <div className="bg-white p-6 rounded-lg border">
              <h2 className="font-semibold mb-4">Recent Feedback</h2>
              <div className="space-y-3">
                {localFeedback.slice(0, 10).map((fb) => (
                  <div key={fb.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={n <= fb.rating ? 'text-yellow-400' : 'text-gray-300'}>★</span>
                      ))}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{fb.target}</p>
                      {fb.comment && <p className="text-sm text-gray-600">{fb.comment}</p>}
                      <p className="text-xs text-gray-400">{new Date(fb.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-gray-500">No data available.</p>
      )}
    </div>
  );
}
