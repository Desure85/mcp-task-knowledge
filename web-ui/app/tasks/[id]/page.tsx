/**
 * web-ui/app/tasks/[id]/page.tsx — full task page (UI-37).
 *
 * A direct, reload-safe URL for one task: read/edit fields, dependencies,
 * subtasks, claim lease (U-01), and archive/trash through a destructive Dialog.
 * Status changes go through tasks_update, so the server remains the owner of
 * the project transition graph (V-02) and returns TRANSITION_NOT_ALLOWED.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  api,
  ToolCallError,
  type ProjectStatus,
  type ProjectType,
  type Task,
} from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';

type Priority = 'low' | 'medium' | 'high';
type DestructiveAction = 'archive' | 'trash';

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isActiveClaim(task: Task, now: number): boolean {
  if (!task.claim?.expiresAt) return false;
  return new Date(task.claim.expiresAt).getTime() > now;
}

export default function TaskPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();

  const [project, setProject] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [types, setTypes] = useState<ProjectType[]>([]);
  const [transitions, setTransitions] = useState<Record<string, string[]> | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [dagEdges, setDagEdges] = useState<Array<{ from: string; to: string }>>([]);
  const [children, setChildren] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transitionError, setTransitionError] = useState<{ code: string; message: string; hint?: string; allowed: string[] } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [destructive, setDestructive] = useState<DestructiveAction | null>(null);
  const [destructiveBusy, setDestructiveBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [type, setType] = useState('task');
  const [tags, setTags] = useState('');
  const [links, setLinks] = useState('');
  const [status, setStatus] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);

  const hydrate = useCallback((value: Task) => {
    setTask(value);
    setTitle(value.title);
    setDescription(value.description ?? '');
    setPriority(value.priority);
    setType(value.type ?? 'task');
    setTags((value.tags ?? []).join(', '));
    setLinks((value.links ?? []).join(', '));
    setStatus(value.status);
    setDependsOn(value.dependsOn ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setError(null);
      try {
        const current = await api.projects.getCurrent();
        if (!alive) return;
        setProject(current.project);
        const [taskResult, statusResult, transitionResult, typeResult, listResult, dagResult, childrenResult] =
          await Promise.allSettled([
            api.tasks.get(current.project, id),
            api.projects.statuses.get(current.project),
            api.projects.transitions.get(current.project),
            api.projects.types.get(current.project),
            api.tasks.list(current.project),
            api.tasks.dag(current.project),
            api.tasks.getChildren(current.project, id),
          ]);
        if (!alive) return;
        if (taskResult.status === 'rejected') {
          const reason = taskResult.reason as Error;
          if (/not found|not_found/i.test(reason.message)) setNotFound(true);
          else setError(reason.message);
        } else {
          hydrate(taskResult.value);
        }
        if (statusResult.status === 'fulfilled') setStatuses(statusResult.value.statuses);
        if (transitionResult.status === 'fulfilled') setTransitions(transitionResult.value.transitions);
        if (typeResult.status === 'fulfilled') setTypes(typeResult.value.types);
        if (listResult.status === 'fulfilled') setAllTasks(listResult.value);
        if (dagResult.status === 'fulfilled') setDagEdges(dagResult.value.edges);
        if (childrenResult.status === 'fulfilled') setChildren(childrenResult.value.children);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrate, id]);

  const statusLabel = useMemo(
    () => new Map(statuses.map((item) => [item.id, item.label])),
    [statuses],
  );

  const taskTitleById = useMemo(
    () => new Map(allTasks.map((item) => [item.id, item.title])),
    [allTasks],
  );

  const blocking = useMemo(
    () =>
      dagEdges
        .filter((edge) => edge.to === id)
        .map((edge) => ({ id: edge.from, title: taskTitleById.get(edge.from) ?? edge.from })),
    [dagEdges, id, taskTitleById],
  );

  const subtasks = children;

  const save = async () => {
    if (!project || !task) return;
    setSaving(true);
    setError(null);
    setTransitionError(null);
    try {
      const updated = await api.tasks.update(project, id, {
        title,
        description,
        priority,
        type,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        links: links.split(',').map((link) => link.trim()).filter(Boolean),
        status,
        dependsOn,
      });
      hydrate(updated);
      setAllTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      if (e instanceof ToolCallError && e.code === 'TRANSITION_NOT_ALLOWED') {
        const details = e.details as { allowed?: string[] } | undefined;
        setTransitionError({ code: e.code, message: e.message, hint: e.hint, allowed: details?.allowed ?? e.allowed ?? [] });
      } else {
        setError((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  const updateClaim = async (action: 'claim' | 'renew' | 'release') => {
    if (!project || !task) return;
    setClaimBusy(true);
    setClaimNotice(null);
    setError(null);
    try {
      if (action === 'release') {
        await api.tasks.release(project, task.id);
        hydrate({ ...task, claim: undefined });
        setClaimNotice('Claim released.');
      } else {
        const result =
          action === 'claim'
            ? await api.tasks.claim(project, task.id, { client: 'web-ui' })
            : await api.tasks.renew(project, task.id);
        hydrate({ ...task, claim: result.claim });
        setClaimNotice(action === 'claim' ? 'Task claimed.' : 'Claim renewed.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClaimBusy(false);
    }
  };

  const runDestructive = async () => {
    if (!project || !destructive) return;
    setDestructiveBusy(true);
    setError(null);
    try {
      if (destructive === 'archive') await api.tasks.bulkArchive(project, [id]);
      else await api.tasks.bulkTrash(project, [id]);
      router.push('/tasks');
    } catch (e) {
      setError((e as Error).message);
      setDestructive(null);
    } finally {
      setDestructiveBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <PageHeader title="Task not found" description={`No task with id "${id}" in the current project.`} />
        <EmptyState
          title="This task does not exist"
          hint="It may have been deleted, or the URL belongs to another project."
          action={
            <Link href="/tasks" className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-accent px-3 text-[13px] font-medium text-on-accent">Back to tasks</Link>
          }
        />
      </div>
    );
  }

  if (!project || !task) {
    return (
      <div className="space-y-4">
        <PageHeader title="Task" description="Could not load this task." />
        {error && (
          <div role="alert" className="rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 p-4 text-[13px] text-danger">
            {error}
          </div>
        )}
        <Link href="/tasks" className="text-[13px] text-accent underline">
          Back to tasks
        </Link>
      </div>
    );
  }

  const activeClaim = isActiveClaim(task, Date.now());

  return (
    <div className="space-y-5">
      <PageHeader
        title={task.title}
        description={`Task ${task.id} in project ${project}`}
        actions={
          <>
            <Link href="/tasks" className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">Back to tasks</Link>
            <Button variant="secondary" onClick={() => setDestructive('archive')}>
              Archive
            </Button>
            <Button variant="danger" onClick={() => setDestructive('trash')}>
              Trash
            </Button>
          </>
        }
      />

      {error && (
        <div role="alert" className="rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 p-3 text-[13px] text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <div className="space-y-3">
              <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Textarea
                label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={6}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
                <Select label="Type" value={type} onChange={(event) => setType(event.target.value)}>
                  {(types.length > 0 ? types : [{ id: 'task', label: 'Task' }, { id: 'bug', label: 'Bug' }, { id: 'feature', label: 'Feature' }]).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {statuses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                <Input label="Tags" value={tags} onChange={(event) => setTags(event.target.value)} hint="Comma-separated" />
              </div>
              <Input label="Links" value={links} onChange={(event) => setLinks(event.target.value)} hint="Comma-separated" />
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
                {transitions?.[task.status] && (
                  <span className="text-[11px] text-muted">
                    Allowed next: {transitions[task.status].map((next) => statusLabel.get(next) ?? next).join(', ')}
                  </span>
                )}
              </div>
              {transitionError && (
                <div role="alert" className="rounded-[var(--radius-control)] border border-danger/40 bg-surface-2 p-3 text-[12px] text-danger">
                  <p className="font-semibold">Transition rejected by the server ({transitionError.code})</p>
                  <p className="mt-1">{transitionError.message}</p>
                  {transitionError.hint && <p className="mt-1 text-muted">{transitionError.hint}</p>}
                  {transitionError.allowed.length > 0 && (
                    <p className="mt-1 text-muted">Allowed: {transitionError.allowed.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Claim (U-01)" />
            <CardBody>
              {activeClaim && task.claim ? (
                <div className="space-y-2 text-[12px]">
                  <Badge tone="doing">Claimed</Badge>
                  <p className="text-muted">Session: {task.claim.bySessionId}</p>
                  {task.claim.client && <p className="text-muted">Client: {task.claim.client}</p>}
                  <p className="text-muted">Expires: {formatDate(task.claim.expiresAt)}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="secondary" onClick={() => void updateClaim('renew')} disabled={claimBusy}>
                      Renew
                    </Button>
                    <Button variant="secondary" onClick={() => void updateClaim('release')} disabled={claimBusy}>
                      Release
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] text-muted">No active lease. Claiming prevents another agent from taking this task.</p>
                  <Button variant="primary" onClick={() => void updateClaim('claim')} disabled={claimBusy}>
                    {claimBusy ? 'Claiming…' : 'Claim task'}
                  </Button>
                </div>
              )}
              {claimNotice && <p className="mt-2 text-[12px] text-success">{claimNotice}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Dependencies" />
            <CardBody>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Depends on</p>
              {(task.dependsOn ?? []).length === 0 ? (
                <p className="mt-1 text-[12px] text-muted">No dependencies.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px]">
                  {(task.dependsOn ?? []).map((depId) => (
                    <li key={depId}>
                      <Link href={`/tasks/${depId}`} className="text-accent underline">
                        {taskTitleById.get(depId) ?? depId}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Blocks</p>
              {blocking.length === 0 ? (
                <p className="mt-1 text-[12px] text-muted">Does not block other tasks.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px]">
                  {blocking.map((item) => (
                    <li key={item.id}>
                      <Link href={`/tasks/${item.id}`} className="text-accent underline">
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Subtasks</p>
              {subtasks.length === 0 ? (
                <p className="mt-1 text-[12px] text-muted">No subtasks.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px]">
                  {subtasks.map((item) => (
                    <li key={item.id}>
                      <Link href={`/tasks/${item.id}`} className="text-accent underline">
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <p className="text-[12px] text-muted">Created: {formatDate(task.createdAt)}</p>
              <p className="text-[12px] text-muted">Updated: {formatDate(task.updatedAt)}</p>
              <p className="mt-2 text-[11px] text-muted">
                Version history is not part of the task wire format yet; this section reflects the current revision only.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog
        open={destructive !== null}
        onClose={() => setDestructive(null)}
        title={destructive === 'archive' ? 'Archive this task?' : 'Move this task to trash?'}
        description={
          destructive === 'archive'
            ? 'Archived tasks disappear from the board and can be restored later.'
            : 'Trashed tasks disappear from the board and can be restored from trash.'
        }
        destructive
        footer={
          <>
            <Button onClick={() => setDestructive(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void runDestructive()} disabled={destructiveBusy}>
              {destructiveBusy ? 'Working…' : destructive === 'archive' ? 'Archive' : 'Move to trash'}
            </Button>
          </>
        }
      />
    </div>
  );
}
