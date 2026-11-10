/**
 * web-ui/app/tasks/dag/page.tsx — project dependency graph (UI-38).
 *
 * The former inline "Dependencies" summary is now a route so the filters are
 * real server arguments (`tag`, `limit`, `onlyWithDeps`) instead of client-side
 * slicing of a fixed page.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type DagData } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, CardBody, CardHeader, EmptyState, Input, Select, Skeleton } from '@/components/ui';

export default function TaskDagPage() {
  const [project, setProject] = useState<string | null>(null);
  const [dag, setDag] = useState<DagData | null>(null);
  const [tag, setTag] = useState('');
  const [limit, setLimit] = useState(200);
  const [onlyWithDeps, setOnlyWithDeps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (current: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.tasks.dag(current, {
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        limit,
        onlyWithDeps,
      });
      setDag(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tag, limit, onlyWithDeps]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const current = await api.projects.getCurrent();
        if (!alive) return;
        setProject(current.project);
        await load(current.project);
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // The initial load is keyed by project only; filter changes use the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dependencies" description="Project task dependency graph." />
        {error ? <p className="text-[13px] text-danger">{error}</p> : <Skeleton className="h-40 w-full" />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dependencies"
        description="Task dependency graph for the current project. Filters are sent to the server."
        actions={
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2"
          >
            Back to tasks
          </Link>
        }
      />

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input label="Tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="e.g. backend" />
        </div>
        <Select label="Limit" value={String(limit)} onChange={(event) => setLimit(Number(event.target.value))}>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="500">500</option>
        </Select>
        <Button
          type="button"
          variant={onlyWithDeps ? 'primary' : 'secondary'}
          aria-pressed={onlyWithDeps}
          onClick={() => setOnlyWithDeps((value) => !value)}
        >
          Only with dependencies
        </Button>
        <Button type="button" variant="primary" onClick={() => void load(project)}>
          Apply
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 p-3 text-[13px] text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : !dag || dag.totalTasks === 0 ? (
        <EmptyState
          title="No tasks in this graph"
          hint="Change the tag/only-with-dependencies filter, or add dependencies from a task page."
          action={
            <Link href="/tasks" className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-accent px-3 text-[13px] font-medium text-on-accent">
              Back to tasks
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title={`Edges (${dag.edges.length})`} />
            <CardBody>
              {dag.edges.length === 0 ? (
                <p className="text-[13px] text-muted">No dependency edges in this page.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {dag.edges.map((edge) => (
                    <li key={`${edge.from}-${edge.to}`}>
                      <Link href={`/tasks/${edge.from}`} className="text-accent underline">
                        {edge.from.slice(0, 8)}
                      </Link>
                      <span className="text-muted"> depends on </span>
                      <Link href={`/tasks/${edge.to}`} className="text-accent underline">
                        {edge.to.slice(0, 8)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {dag.truncated && (
                <p className="mt-3 text-[11px] text-muted">
                  Page truncated: {dag.returnedNodes ?? dag.topologicalOrder.length} of {dag.totalTasks} nodes.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <p className="text-[13px] text-ink">Tasks on page: {dag.topologicalOrder.length}</p>
              <p className="text-[13px] text-ink">Tasks with dependencies: {dag.tasksWithDeps}</p>
              <p className="text-[13px] text-ink">Blocked by dependencies: {dag.blockedCount}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Critical path</p>
              {dag.criticalPath.length === 0 ? (
                <p className="text-[12px] text-muted">No path in this page.</p>
              ) : (
                <ol className="mt-1 space-y-1 text-[12px]">
                  {dag.criticalPath.map((node) => (
                    <li key={node.id}>
                      <Link href={`/tasks/${node.id}`} className="text-accent underline">
                        {node.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
