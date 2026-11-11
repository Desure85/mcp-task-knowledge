/**
 * web-ui/app/analytics/page.tsx — Feedback loop & analytics (UI-006, UI-24).
 *
 * Usage tracking (anonymous), feedback forms, analytics dashboard.
 * Shows task stats, knowledge stats, search stats, memory stats.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type DashboardActivity, type DashboardTrends } from '@/lib/api-client';
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

function TrendChart({ trends }: { trends: DashboardTrends }) {
  const max = Math.max(1, ...trends.daily.map((bucket) => Math.max(bucket.created, bucket.completed)));
  const step = Math.max(1, Math.ceil(trends.daily.length / 6));
  return (
    <div role="img" aria-label={`Task throughput: ${trends.summary.totalCreated} created, ${trends.summary.totalCompleted} completed over ${trends.period.days} days`}>
      <div className="flex h-40 items-end gap-1" data-testid="analytics-chart">
        {trends.daily.map((bucket, index) => (
          <div key={bucket.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <div
                className="w-2/5 rounded-t-[var(--radius-control)] bg-accent"
                style={{ height: `${(bucket.created / max) * 100}%` }}
                title={`${bucket.date}: ${bucket.created} created`}
              />
              <div
                className="w-2/5 rounded-t-[var(--radius-control)] bg-st-done"
                style={{ height: `${(bucket.completed / max) * 100}%` }}
                title={`${bucket.date}: ${bucket.completed} completed`}
              />
            </div>
            <span className="tnum text-[10px] text-muted">
              {index % step === 0 ? bucket.date.slice(5) : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-accent" />Created</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-st-done" />Completed</span>
        <span className="ml-auto tnum">
          {trends.summary.totalCreated} created · {trends.summary.totalCompleted} completed · {trends.summary.netOpen >= 0 ? '+' : ''}{trends.summary.netOpen} net
        </span>
      </div>
    </div>
  );
}

function ActivityFeed({ activity, onCreate }: { activity: DashboardActivity; onCreate: () => void }) {
  if (activity.items.length === 0) {
    return (
      <EmptyState
        compact
        title="No activity yet"
        hint="Create a task or document to start the feed."
        action={<Button size="sm" variant="secondary" onClick={onCreate}>Create a task</Button>}
      />
    );
  }
  return (
    <ul aria-label="Recent activity" className="divide-y divide-line">
      {activity.items.slice(0, 12).map((item) => (
        <li key={`${item.type}:${item.id}`} className="flex min-h-[var(--spacing-row)] items-center gap-3 py-2 text-[12px]">
          <Badge>{item.type}</Badge>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.title}</span>
          <span className="shrink-0 text-[11px] text-muted">{item.action}</span>
          <span className="shrink-0 tnum text-[11px] text-muted">
            {new Date(item.updatedAt).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
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
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [activity, setActivity] = useState<DashboardActivity | null>(null);
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [days, setDays] = useState(30);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      // Prefer the server-side aggregate (dashboard_stats); fall back to
      // client-side counting over raw lists when it is unavailable.
      const [dashResult, trendsResult, activityResult] = await Promise.allSettled([
        api.system.dashboardStats(),
        api.system.dashboardTrends({ days, granularity }),
        api.system.dashboardActivity({ limit: 12 }),
      ]);
      if (trendsResult.status === 'fulfilled') setTrends(trendsResult.value);
      if (activityResult.status === 'fulfilled') setActivity(activityResult.value);
      const dash = dashResult.status === 'fulfilled' ? dashResult.value : null;
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
  }, [days, granularity]);

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
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Granularity" className="flex items-center gap-1">
              {(['day', 'week'] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={granularity === value ? 'primary' : 'secondary'}
                  aria-pressed={granularity === value}
                  onClick={() => setGranularity(value)}
                >
                  {value === 'day' ? 'Daily' : 'Weekly'}
                </Button>
              ))}
            </div>
            <div role="group" aria-label="Period" className="ml-auto flex items-center gap-1">
              {[7, 30, 90].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={days === value ? 'primary' : 'secondary'}
                  aria-pressed={days === value}
                  onClick={() => setDays(value)}
                >
                  {value}d
                </Button>
              ))}
            </div>
          </div>

          {stats.totalTasks === 0 ? (
            <EmptyState
              title="No analytics yet"
              hint="Create your first task — trends and the activity feed will fill in as the project moves."
              action={<Button variant="primary" onClick={() => { window.location.href = '/tasks'; }}>Create a task</Button>}
            />
          ) : (
            <>
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

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="text-[13px] font-semibold text-ink">Throughput</h2>
              </CardHeader>
              <CardBody>
                {trends ? (
                  <TrendChart trends={trends} />
                ) : (
                  <EmptyState compact title="No trend data" hint="dashboard_trends returned nothing." />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="text-[13px] font-semibold text-ink">Recent activity</h2>
              </CardHeader>
              <CardBody>
                {activity ? (
                  <ActivityFeed activity={activity} onCreate={() => { window.location.href = '/tasks'; }} />
                ) : (
                  <EmptyState compact title="No activity available" hint="dashboard_activity returned nothing." />
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
            </>
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
