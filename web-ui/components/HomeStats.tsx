/**
 * web-ui/components/HomeStats.tsx — Overview metric tiles.
 *
 * Reads dashboard_stats from the MCP server. Degrades to an em dash when the
 * server is unreachable so the overview never blocks on a failed call.
 */

'use client';

import { useEffect, useState } from 'react';
import { api, type DashboardStats } from '@/lib/api-client';
import { StatTile } from './StatTile';
import { Skeleton } from './Skeleton';
import { IconAnalytics, IconKnowledge, IconTasks } from './icons';

export function HomeStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.system
      .dashboardStats()
      .then((data) => {
        if (!alive) return;
        setStats(data);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-3 h-6 w-14" />
            <Skeleton className="mt-3 h-2.5 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const dash = '—';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Tasks"
        value={stats ? stats.tasks.total : dash}
        hint={stats ? `${stats.tasks.active} active now` : 'Server unreachable'}
        icon={IconTasks}
      />
      <StatTile
        label="Completion"
        value={stats ? stats.tasks.completionRate : dash}
        hint={stats ? `${stats.tasks.completed} completed · ${stats.tasks.blocked} blocked` : 'Server unreachable'}
        icon={IconAnalytics}
      />
      <StatTile
        label="Dependencies"
        value={stats ? stats.tasks.totalDependencies : dash}
        hint={stats ? `${stats.tasks.withDependencies} tasks with deps` : 'Server unreachable'}
        icon={IconAnalytics}
      />
      <StatTile
        label="Knowledge"
        value={stats ? stats.knowledge.total : dash}
        hint={stats ? `${stats.tags.unique} unique tags` : failed ? 'Server unreachable' : 'Documents'}
        icon={IconKnowledge}
      />
    </div>
  );
}
