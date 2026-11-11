/**
 * web-ui/components/board/TaskQuickView.tsx — read-only quick view (UI-36).
 *
 * Opened from a task card. Shows the full description, type/priority/tags,
 * links, dependencies, subtasks, claim lease and timestamps. There is no
 * editing here by design: the only write path is the Edit button that opens
 * the full task page (UI-37).
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  api,
  type ProjectStatus,
  type ProjectType,
  type Task,
} from '@/lib/api-client';
import { Badge, Button, Dialog, Skeleton } from '@/components/ui';
import { renderMarkdown } from '@/lib/markdown';

export interface TaskQuickViewProps {
  task: Task;
  project: string;
  statuses: ProjectStatus[];
  types: ProjectType[];
  onClose: () => void;
  onEdit: () => void;
  onOpenRelated: (taskId: string) => void;
}

function format(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TaskQuickView({ task, project, statuses, types, onClose, onEdit, onOpenRelated }: TaskQuickViewProps) {
  const [details, setDetails] = useState<Task | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [children, setChildren] = useState<Task[]>([]);
  const [deps, setDeps] = useState<Awaited<ReturnType<typeof api.tasks.getDeps>> | null>(null);
  const [rootChain, setRootChain] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const [full, list, childResult, depResult] = await Promise.all([
          api.tasks.get(project, task.id, { includeGraphMetrics: true }),
          api.tasks.list(project),
          api.tasks.getChildren(project, task.id),
          api.tasks.getDeps(project, task.id),
        ]);
        if (!alive) return;
        setDetails(full);
        setTasks(list);
        setChildren(childResult.children);
        setDeps(depResult);
        const chain: Array<{ id: string; title: string; status: string }> = [];
        let cursor = depResult?.dependsOn[0];
        const seen = new Set<string>();
        while (cursor && !seen.has(cursor.id) && chain.length < 10) {
          seen.add(cursor.id);
          chain.push(cursor);
          try {
            const next = await api.tasks.getDeps(project, cursor.id);
            cursor = next.dependsOn[0];
          } catch {
            break;
          }
        }
        setRootChain(chain);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [project, task.id]);

  const value = details ?? task;
  const titleById = useMemo(() => new Map(tasks.map((item) => [item.id, item.title])), [tasks]);
  const statusOf = (id: string) => statuses.find((status) => status.id === id)?.label ?? id;
  const statusLabel = statuses.find((status) => status.id === value.status)?.label ?? value.status;
  const typeLabel = types.find((item) => item.id === (value.type ?? 'task'))?.label ?? value.type ?? 'Task';
  const activeClaim = Boolean(value.claim && new Date(value.claim.expiresAt).getTime() > Date.now());

  return (
    <Dialog
      open
      onClose={onClose}
      title={value.title}
      description={`${statusLabel} · ${typeLabel} · ${value.priority} priority`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onEdit}>
            Edit
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : failed ? (
        <p className="text-[13px] text-danger">Could not load this task. Close the dialog and retry.</p>
      ) : (
        <div className="space-y-4 text-[13px]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Description</p>
            <div className="prose mt-1 leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(value.description?.trim() || 'No description.') }} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{statusLabel}</Badge>
            <Badge tone="neutral">{value.priority}</Badge>
            {value.onCriticalPath && (
              <Badge tone="doing" title="On the longest dependency chain">Critical path</Badge>
            )}
            {(value.dependentsCount ?? 0) > 0 && (
              <Badge tone={(value.dependentsCount ?? 0) >= 3 ? 'blocked' : 'medium'} title="Transitive dependents">
                Blocks {value.dependentsCount}
              </Badge>
            )}
            {(value.tags ?? []).map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </div>

          {(value.links ?? []).length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Links</p>
              <ul className="mt-1 space-y-1">
                {(value.links ?? []).map((link) => (
                  <li key={link}>
                    <a href={link} className="text-accent underline" target="_blank" rel="noreferrer">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Depends on</p>
              {rootChain.length > 0 && (
                <p className="mt-1 text-[11px] text-muted">Root chain: {rootChain.map((node) => `${node.title} (${statusOf(node.status)})`).join(' → ')}</p>
              )}
              {(deps?.dependsOn ?? []).length === 0 ? (
                <p className="mt-1 text-muted">No dependencies.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {(deps?.dependsOn ?? []).map((dep) => (
                    <li key={dep.id}>
                      <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-left text-[12px] text-accent underline hover:bg-transparent hover:text-accent" onClick={() => onOpenRelated(dep.id)}>{dep.title}</Button>
                      <span className="ml-1 text-muted">({statusOf(dep.status)})</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted">{deps?.isBlocked ? 'Blocked by unmet dependencies' : 'Dependencies satisfied'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Blocks</p>
              {(deps?.dependedBy ?? []).length === 0 ? (
                <p className="mt-1 text-muted">Does not block other tasks.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {(deps?.dependedBy ?? []).map((dep) => (
                    <li key={dep.id}>
                      <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-left text-[12px] text-accent underline hover:bg-transparent hover:text-accent" onClick={() => onOpenRelated(dep.id)}>{dep.title}</Button>
                      <span className="ml-1 text-muted">({statusOf(dep.status)})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Subtasks</p>
              {children.length === 0 ? (
                <p className="mt-1 text-muted">No subtasks.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {children.map((child) => (
                    <li key={child.id}>
                      <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-left text-[12px] text-accent underline hover:bg-transparent hover:text-accent" onClick={() => onOpenRelated(child.id)}>{child.title}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Claim</p>
              {activeClaim && value.claim ? (
                <div className="mt-1 space-y-0.5 text-muted">
                  <p>Claimed by {value.claim.client ?? value.claim.bySessionId}</p>
                  <p>Expires {format(value.claim.expiresAt)}</p>
                </div>
              ) : (
                <p className="mt-1 text-muted">No active lease.</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">History</p>
            <p className="mt-1 text-muted">Created {format(value.createdAt)}</p>
            <p className="text-muted">Updated {format(value.updatedAt)}</p>
            <p className="mt-1 text-[11px] text-muted">Version history is not part of the task wire format; this is the current revision.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
