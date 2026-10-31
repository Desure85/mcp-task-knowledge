/**
 * web-ui/app/tasks/page.tsx — Tasks board (UI-002, UI-007)
 *
 * Full Kanban board with:
 * - Drag & drop between status columns
 * - Search/filter by title, tags, priority
 * - Create, edit, close tasks
 * - Priority markers, tag chips, subtask indicator
 * - Dependency DAG panel
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Task, type DagData } from '@/lib/api-client';
import { useRealtime, applyTaskEvent } from '@/lib/realtime';
import { PageHeader } from '@/components/PageHeader';
import { PriorityDot } from '@/components/PriorityDot';
import { Badge, Button, EmptyState } from '@/components/ui';
import { SkeletonColumn } from '@/components/Skeleton';
import { publishLiveStatus, clearLiveStatus } from '@/components/live-status';
import {
  IconAlert,
  IconClose,
  IconDependencies,
  IconPlus,
  IconSearch,
  IconSubtask,
} from '@/components/icons';

type Status = 'pending' | 'in_progress' | 'completed' | 'closed';
type Priority = 'low' | 'medium' | 'high';

const COLUMNS: { status: Status; label: string; dot: string }[] = [
  { status: 'pending', label: 'Pending', dot: 'bg-st-todo' },
  { status: 'in_progress', label: 'In progress', dot: 'bg-st-doing' },
  { status: 'completed', label: 'Completed', dot: 'bg-st-done' },
  { status: 'closed', label: 'Closed', dot: 'bg-st-archive' },
];

const INPUT_CLASS =
  'h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-muted transition duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const SELECT_CLASS =
  'h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13px] text-ink transition duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const GHOST_ICON_BUTTON =
  'grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted transition duration-150 hover:bg-surface-2 hover:text-ink';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newTags, setNewTags] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterTag, setFilterTag] = useState<string>('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Status | null>(null);
  const [showDag, setShowDag] = useState(false);
  const [dag, setDag] = useState<DagData | null>(null);
  const dragCounter = useRef(0);

  // NEXT2-005: live-updates — merge task.* events from other clients;
  // publish our own mutations so other tabs update instantly.
  const { status: liveStatus, presence, publish } = useRealtime({
    eventTypes: ['task.created', 'task.updated', 'task.closed', 'task.deleted'],
    onEvent: (event) => {
      setTasks((prev) => applyTaskEvent(prev, event));
    },
  });

  // Mirror the single realtime connection into the top-bar pill (UI-007).
  useEffect(() => {
    publishLiveStatus(liveStatus, presence.length);
  }, [liveStatus, presence.length]);

  useEffect(() => () => clearLiveStatus(), []);

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.tasks.list();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function createTask() {
    if (!newTitle.trim()) return;
    try {
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
      const created = await api.tasks.create({ title: newTitle, priority: newPriority, tags });
      publish('task.created', created as unknown as Record<string, unknown>);
      setNewTitle('');
      setNewTags('');
      setNewPriority('medium');
      setShowCreate(false);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function closeTask(id: string) {
    try {
      const closed = await api.tasks.close('mcp', id);
      publish('task.closed', closed as unknown as Record<string, unknown>);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function updateTaskStatus(id: string, status: Status) {
    try {
      const updated = await api.tasks.update('mcp', id, { status });
      publish('task.updated', updated as unknown as Record<string, unknown>);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveEdit() {
    if (!editingTask) return;
    try {
      const updated = await api.tasks.update('mcp', editingTask.id, {
        title: editingTask.title,
        priority: editingTask.priority,
        tags: editingTask.tags,
      });
      publish('task.updated', updated as unknown as Record<string, unknown>);
      setEditingTask(null);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDag() {
    if (!showDag && !dag) {
      try {
        setDag(await api.tasks.dag());
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setShowDag(!showDag);
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, col: Status) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(col);
  }

  function handleDragEnter() {
    dragCounter.current++;
  }

  function handleDragLeave() {
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOverCol(null);
  }

  function handleDrop(e: React.DragEvent, col: Status) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverCol(null);
    if (draggedId) {
      void updateTaskStatus(draggedId, col);
      setDraggedId(null);
    }
  }

  const allTags = Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort();

  const filtered = tasks.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterTag && !(t.tags ?? []).includes(filterTag)) return false;
    return true;
  });

  const filtersActive = Boolean(searchQuery) || filterPriority !== 'all' || Boolean(filterTag);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        description="Drag cards between columns to change status. Click a title to edit."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => void toggleDag()}>
              <IconDependencies className="h-4 w-4 text-muted" />
              {showDag ? 'Hide DAG' : 'Dependencies'}
            </Button>
            <Button type="button" variant="primary" onClick={() => setShowCreate(!showCreate)}>
              <IconPlus className="h-4 w-4" />
              New task
            </Button>
          </>
        }
      />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 px-3 py-2.5 text-[12px] text-danger">
          <div className="flex items-start gap-2">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="rounded-[var(--radius-control)] p-0.5 text-danger transition duration-150 hover:bg-surface-2"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showCreate && (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            New task
          </p>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title…"
            className={INPUT_CLASS}
            onKeyDown={(e) => e.key === 'Enter' && createTask()}
            autoFocus
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Priority)}
              className={SELECT_CLASS}
              aria-label="Priority"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="tags (comma-separated)"
              className={`${INPUT_CLASS} sm:flex-1`}
              aria-label="Tags"
            />
            <Button type="button" variant="primary" onClick={createTask}>
              Create
            </Button>
          </div>
        </div>
      )}

      {editingTask && (
        <div className="rounded-[var(--radius-card)] border border-accent bg-surface p-4 ring-1 ring-focus-ring/30">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
              Edit task
            </p>
            <button
              type="button"
              onClick={() => setEditingTask(null)}
              aria-label="Close editor"
              className={GHOST_ICON_BUTTON}
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={editingTask.title}
            onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
            className={INPUT_CLASS}
            aria-label="Task title"
          />
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              value={editingTask.priority}
              onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as Priority })}
              className={SELECT_CLASS}
              aria-label="Priority"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="text"
              value={(editingTask.tags ?? []).join(', ')}
              onChange={(e) =>
                setEditingTask({
                  ...editingTask,
                  tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                })
              }
              placeholder="tags"
              className={`${INPUT_CLASS} sm:flex-1`}
              aria-label="Tags"
            />
            <Button type="button" variant="primary" onClick={saveEdit}>
              Save
            </Button>
          </div>
        </div>
      )}

      {showDag && dag && (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3">
            <h3 className="mr-1 text-[13px] font-semibold text-ink">Dependencies</h3>
            <Badge>{dag.totalTasks} tasks</Badge>
            <Badge>{dag.tasksWithDeps} with deps</Badge>
            <Badge>{dag.edges.length} edges</Badge>
            <Badge tone="blocked">Blocked {dag.blockedCount}</Badge>
            <Badge tone="doing">Critical path {dag.criticalPath.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-5 p-4 text-[11px] md:grid-cols-3">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Critical path
              </p>
              {dag.criticalPath.length === 0 && <p className="text-muted">—</p>}
              {dag.criticalPath.map((t) => (
                <p key={t.id} className="truncate text-muted">
                  {t.id} — {t.title} <span className="text-muted">({t.status})</span>
                </p>
              ))}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Topological order
              </p>
              {dag.topologicalOrder.slice(0, 30).map((t, i) => (
                <p
                  key={t.id}
                  className={`truncate ${
                    t.status === 'completed' || t.status === 'closed'
                      ? 'text-muted line-through'
                      : 'text-muted'
                  }`}
                >
                  {i + 1}. {t.title} <span className="text-muted">({t.status})</span>
                </p>
              ))}
              {dag.topologicalOrder.length > 30 && (
                <p className="text-muted">… +{dag.topologicalOrder.length - 30} more</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Edges (depends on →)
              </p>
              {dag.edges.length === 0 && <p className="text-muted">No dependencies.</p>}
              {dag.edges.slice(0, 30).map((e, i) => (
                <p key={i} className="truncate font-mono text-muted">
                  {e.to} ← {e.from}
                </p>
              ))}
              {dag.edges.length > 30 && (
                <p className="text-muted">… +{dag.edges.length - 30} more</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="h-9 w-full rounded-[var(--radius-control)] border border-transparent bg-surface-2 pl-8 pr-3 text-[13px] text-ink placeholder:text-muted transition duration-150 focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
          />
        </div>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as Priority | 'all')}
          className={SELECT_CLASS}
          aria-label="Filter by priority"
        >
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
        {!loading && (
          <p className="px-1 text-[11px] text-muted sm:shrink-0">
            Showing <span className="font-medium text-ink">{filtered.length}</span> of{' '}
            {tasks.length} tasks
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-hidden xl:grid xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.status} className="w-[300px] shrink-0 xl:w-auto">
              <SkeletonColumn />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex snap-x gap-4 overflow-x-auto pb-2 xl:grid xl:grid-cols-4 xl:overflow-visible xl:pb-0">
          {COLUMNS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.status);
            const isOver = dragOverCol === col.status;
            return (
              <div
                key={col.status}
                className={`flex w-[300px] shrink-0 snap-start flex-col rounded-[var(--radius-card)] border transition duration-150 xl:w-auto ${
                  isOver
                    ? 'border-accent bg-accent-soft ring-2 ring-accent/40'
                    : 'border-line bg-surface-2'
                }`}
                onDragOver={(e) => handleDragOver(e, col.status)}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.status)}
              >
                <div className="z-10 flex items-center justify-between gap-2 rounded-t-xl border-b border-line bg-surface-2 px-3 py-2.5 backdrop-blur lg:sticky lg:top-14">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${col.dot}`} aria-hidden="true" />
                    <h3 className="truncate text-[12px] font-semibold text-ink">{col.label}</h3>
                  </div>
                  <Badge className="tabular-nums">{colTasks.length}</Badge>
                </div>

                <div className="flex-1 space-y-2 p-2.5">
                  {colTasks.map((task) => {
                    const tags = task.tags ?? [];
                    return (
                      <article
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onDragEnd={() => setDraggedId(null)}
                        className={`group/card cursor-grab rounded-[var(--radius-control)] border border-line bg-surface p-3 transition duration-150 hover:border-line-strong  active:cursor-grabbing ${
                          draggedId === task.id ? 'opacity-60' : ''
                        }`}
                      >
                        <p
                          role="button"
                          tabIndex={0}
                          className="line-clamp-2 cursor-pointer rounded text-[13px] font-medium leading-snug text-ink transition duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                          onClick={() => setEditingTask({ ...task })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setEditingTask({ ...task });
                            }
                          }}
                        >
                          {task.title}
                        </p>

                        {tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {tags.slice(0, 3).map((tag) => (
                              <Badge key={tag}>{tag}</Badge>
                            ))}
                            {tags.length > 3 && <Badge className="text-muted">+{tags.length - 3}</Badge>}
                          </div>
                        )}

                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <PriorityDot priority={task.priority} />
                            {task.parentId && (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] text-muted"
                                title="Subtask"
                              >
                                <IconSubtask className="h-3 w-3" />
                                Subtask
                              </span>
                            )}
                          </div>
                          {col.status !== 'closed' && (
                            <button
                              type="button"
                              onClick={() => closeTask(task.id)}
                              className="shrink-0 rounded-[var(--radius-control)] px-1.5 py-1 text-[11px] font-medium text-muted opacity-0 transition duration-150 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover/card:opacity-100"
                            >
                              Close
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  {colTasks.length === 0 && (
                    <EmptyState
                      compact
                      title="No tasks"
                      hint={filtersActive && tasks.length > 0 ? 'No matches for current filters' : undefined}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
