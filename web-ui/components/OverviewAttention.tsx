/**
 * Overview attention widgets (UI-17).
 *
 * Replaces the duplicated navigation-card grid: every tile below either shows
 * data or an explicit empty state with the next action. Sources are existing
 * tools — dashboard_stats, dashboard_activity, tasks_list and knowledge_list.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type DashboardActivity, type DashboardStats, type KnowledgeListItem, type Task } from '@/lib/api-client';
import { Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { Skeleton } from './Skeleton';
import { IconKnowledge, IconTasks } from './icons';

const STALE_DOC_DAYS = 90;

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((Date.now() - time) / 86_400_000);
}

function formatActivityDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function actionLabel(action: string): string {
  return action.replace(/_/g, ' ');
}

export function OverviewAttention() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [docs, setDocs] = useState<KnowledgeListItem[]>([]);
  const [activity, setActivity] = useState<DashboardActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await api.projects.getCurrent();
      const [statsResult, tasksResult, docsResult, activityResult] = await Promise.allSettled([
        api.system.dashboardStats({ project: current.project }),
        api.tasks.list(current.project),
        api.knowledge.list(current.project),
        api.system.dashboardActivity({ project: current.project, limit: 8 }),
      ]);
      if (statsResult.status === 'fulfilled') setStats(statsResult.value);
      if (tasksResult.status === 'fulfilled') setTasks(tasksResult.value);
      if (docsResult.status === 'fulfilled') setDocs(docsResult.value);
      if (activityResult.status === 'fulfilled') setActivity(activityResult.value);
      const failures = [statsResult, tasksResult, docsResult, activityResult].filter((result) => result.status === 'rejected');
      if (failures.length === 4) setError('Could not load the overview.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const blocked = tasks.filter((task) => task.status === 'blocked');
  const claimed = tasks.filter((task) => task.claim && new Date(task.claim.expiresAt).getTime() > Date.now());
  const stale = docs
    .map((doc) => ({ doc, days: daysSince(doc.updatedAt) }))
    .filter((entry): entry is { doc: KnowledgeListItem; days: number } => entry.days !== null && entry.days >= STALE_DOC_DAYS)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <CardBody>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </CardBody>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 p-3 text-[12px] text-danger">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <span>Blocked tasks</span>
              <Link href="/tasks" className="text-[12px] text-accent underline">Open tasks</Link>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex items-center gap-2">
              <IconTasks className="h-4 w-4 text-muted" />
              <span className="text-[20px] font-semibold text-ink">{blocked.length}</span>
              <span className="text-[12px] text-muted">need attention</span>
            </div>
            {blocked.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted">No task is blocked right now.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[13px]">
                {blocked.slice(0, 5).map((task) => (
                  <li key={task.id}>
                    <Link href={`/tasks/${task.id}`} className="text-accent underline">{task.title}</Link>
                    <span className="ml-2 text-[11px] text-muted">{task.priority}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><span>Claimed tasks</span></CardHeader>
          <CardBody>
            <div className="flex items-center gap-2">
              <IconTasks className="h-4 w-4 text-muted" />
              <span className="text-[20px] font-semibold text-ink">{claimed.length}</span>
              <span className="text-[12px] text-muted">active leases</span>
            </div>
            {claimed.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted">No task is claimed right now.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[13px]">
                {claimed.slice(0, 5).map((task) => (
                  <li key={task.id}>
                    <Link href={`/tasks/${task.id}`} className="text-accent underline">{task.title}</Link>
                    <span className="ml-2 text-[11px] text-muted">
                      {task.claim?.client ?? task.claim?.byUserId ?? 'claimed'} · expires {formatActivityDate(task.claim?.expiresAt ?? '')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <span>Stale documents</span>
              <Link href="/knowledge" className="text-[12px] text-accent underline">Open knowledge</Link>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex items-center gap-2">
              <IconKnowledge className="h-4 w-4 text-muted" />
              <span className="text-[20px] font-semibold text-ink">{stale.length}</span>
              <span className="text-[12px] text-muted">older than {STALE_DOC_DAYS} days</span>
            </div>
            {stale.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted">Everything was updated recently.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[13px]">
                {stale.map(({ doc, days }) => (
                  <li key={doc.id}>
                    <Link href={`/knowledge?doc=${doc.id}`} className="text-accent underline">{doc.title}</Link>
                    <span className="ml-2 text-[11px] text-muted">{days} days</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <span>Recent activity</span>
              {activity?.items.length ? <Badge>{activity.count} changes</Badge> : null}
            </div>
          </CardHeader>
          <CardBody>
            {!activity || activity.items.length === 0 ? (
              <p className="text-[12px] text-muted">No recent changes yet. Edit a task or a document to start the feed.</p>
            ) : (
              <ul className="space-y-2 text-[12px]">
                {activity.items.map((item) => (
                  <li key={`${item.type}-${item.id}`} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <Link
                        href={item.type === 'task' ? `/tasks/${item.id}` : `/knowledge?doc=${item.id}`}
                        className="text-ink underline-offset-2 hover:text-accent hover:underline"
                      >
                        {item.title}
                      </Link>
                      <span className="ml-1 text-muted">
                        {item.type === 'task' ? 'task' : 'document'} · {actionLabel(item.action)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{formatActivityDate(item.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="text-[11px] text-muted">
        {stats
          ? `${stats.knowledge.total} documents · ${stats.tags.unique} unique tags · ${stats.tasks.blocked} blocked as reported by dashboard_stats.`
          : 'Metrics unavailable.'}
      </p>
    </div>
  );
}
