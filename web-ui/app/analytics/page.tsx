/**
 * web-ui/app/analytics/page.tsx — Feedback loop & analytics (UI-006, UI-24).
 *
 * Usage tracking (anonymous), feedback forms, analytics dashboard.
 * Shows task stats, knowledge stats, search stats, memory stats.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/StatTile';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Skeleton, Textarea } from '@/components/ui';
import { IconAnalytics, IconKnowledge, IconTasks } from '@/components/icons';

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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-st-todo',
  in_progress: 'bg-st-doing',
  completed: 'bg-st-done',
  closed: 'bg-st-archive',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-pr-high',
  medium: 'bg-pr-med',
  low: 'bg-pr-low',
};

function labelOf(value: string): string {
  return value.replace(/_/g, ' ');
}

function BarRow({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-[12px] capitalize text-ink">{label}</span>
      <div
        role="progressbar"
        aria-label={`${label}: ${count} tasks`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${count} of ${total} tasks (${Math.round(pct)}%)`}
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div className={`h-full ${colorClass} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[12px] font-medium text-ink tnum">{count}</span>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Card className="mb-4 border-danger/40">
      <CardBody className="flex items-start justify-between gap-3">
        <p role="alert" className="text-[12px] text-danger">{message}</p>
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss error">Dismiss</Button>
      </CardBody>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
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
      // Prefer the server-side aggregate (dashboard_stats); fall back to
      // client-side counting over raw lists when it is unavailable.
      const dash = await api.system.dashboardStats().catch(() => null);
      if (dash?.tasks?.total != null) {
        setStats({
          totalTasks: dash.tasks.total,
          tasksByStatus: dash.tasks.byStatus ?? {},
          tasksByPriority: dash.tasks.byPriority ?? {},
          totalKnowledge: dash.knowledge?.total ?? 0,
          totalSearches: 0,
        });
        return;
      }
      const tasks = await api.tasks.list();
      const taskArr = Array.isArray(tasks) ? tasks : [];
      const tasksByStatus: Record<string, number> = {};
      const tasksByPriority: Record<string, number> = {};
      for (const task of taskArr) {
        tasksByStatus[task.status] = (tasksByStatus[task.status] ?? 0) + 1;
        tasksByPriority[task.priority] = (tasksByPriority[task.priority] ?? 0) + 1;
      }

      let totalKnowledge = 0;
      try {
        const docs = await api.knowledge.list();
        totalKnowledge = Array.isArray(docs) ? docs.length : 0;
      } catch {
        // Knowledge stats are optional; task analytics still render.
      }

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
      try {
        setLocalFeedback(JSON.parse(stored));
      } catch {
        // Ignore malformed legacy feedback; the form still works.
      }
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
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Throughput, task distribution and feedback."
        actions={
          <Button variant="primary" onClick={() => setShowFeedbackForm((value) => !value)}>
            Give Feedback
          </Button>
        }
      />

      {error && <div className="mt-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>}

      {showFeedbackForm && (
        <Card className="mt-4">
          <CardHeader>
            <h2 className="text-[13px] font-semibold text-ink">Share feedback</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <Input
              label="What is this about?"
              value={feedbackTarget}
              onChange={(e) => setFeedbackTarget(e.target.value)}
              placeholder="Feature name, page, etc."
            />
            <div>
              <p className="mb-1 text-[11px] font-medium text-ink">Rating</p>
              <div role="group" aria-label="Rating" className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={feedbackRating >= n ? 'primary' : 'secondary'}
                    aria-label={`Rating ${n} of 5`}
                    aria-pressed={feedbackRating === n}
                    onClick={() => setFeedbackRating(n)}
                    className="h-8 w-8 p-0"
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <Textarea
              label="Comments"
              hint="Optional"
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              placeholder="What worked, what did not"
              className="h-24 resize-none"
            />
            <Button variant="primary" onClick={submitFeedback}>Submit</Button>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}><CardBody><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-8 w-16" /></CardBody></Card>
          ))}
        </div>
      ) : stats ? (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatTile label="Total tasks" value={stats.totalTasks} hint="all statuses" icon={IconTasks} />
            <StatTile label="Knowledge docs" value={stats.totalKnowledge} hint="in this project" icon={IconKnowledge} />
            <StatTile label="Feedback entries" value={localFeedback.length} hint="stored in this browser" icon={IconAnalytics} />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="text-[13px] font-semibold text-ink">Tasks by status</h2>
              </CardHeader>
              <CardBody className="space-y-2">
                {Object.entries(stats.tasksByStatus).length === 0 ? (
                  <EmptyState compact title="No tasks" hint="Create a task to populate this chart." />
                ) : (
                  Object.entries(stats.tasksByStatus).map(([status, count]) => (
                    <BarRow
                      key={status}
                      label={labelOf(status)}
                      count={count}
                      total={stats.totalTasks}
                      colorClass={STATUS_COLORS[status] ?? 'bg-muted'}
                    />
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-[13px] font-semibold text-ink">Tasks by priority</h2>
              </CardHeader>
              <CardBody className="space-y-2">
                {Object.entries(stats.tasksByPriority).length === 0 ? (
                  <EmptyState compact title="No tasks" hint="Create a task to populate this chart." />
                ) : (
                  Object.entries(stats.tasksByPriority).map(([priority, count]) => (
                    <BarRow
                      key={priority}
                      label={priority}
                      count={count}
                      total={stats.totalTasks}
                      colorClass={PRIORITY_COLORS[priority] ?? 'bg-muted'}
                    />
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          {localFeedback.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-[13px] font-semibold text-ink">Recent feedback</h2>
              </CardHeader>
              <CardBody className="space-y-3">
                {localFeedback.slice(0, 10).map((fb) => (
                  <div key={fb.id} className="flex items-start gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
                    <span role="img" aria-label={`Rating ${fb.rating} of 5`} className="flex shrink-0">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} aria-hidden="true" className={n <= fb.rating ? 'text-warning' : 'text-muted'}>★</span>
                      ))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-ink">{fb.target}</p>
                      {fb.comment && <p className="mt-0.5 text-[12px] text-muted">{fb.comment}</p>}
                      <p className="mt-1 text-[11px] text-muted">{new Date(fb.createdAt).toLocaleString()}</p>
                    </div>
                    <Badge>{fb.rating} / 5</Badge>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState title="No data available." hint="The analytics endpoint returned no stats." />
        </div>
      )}
    </div>
  );
}
