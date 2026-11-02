/**
 * web-ui/app/tasks/page.tsx — Tasks board (UI-002, UI-007, V-04)
 *
 * Full Kanban board built from the *project's own statuses*:
 * - columns come from `project_statuses_get`, ordered, with collapse/hide prefs
 *   persisted per project
 * - horizontal scrolling with sticky lane headers and "N more" edge cues
 * - transition-aware drag & drop: forbidden columns are dimmed, drops are still
 *   sent to the server (the source of truth) and rejected moves roll back
 * - keyboard "Move to…" menu offering only allowed statuses
 * - Search/filter by title, tags, priority; create, edit, close tasks
 * - Priority markers, tag chips, subtask indicator, dependency DAG panel
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ToolCallError,
  type DagData,
  type ProjectStatus,
  type Task,
} from '@/lib/api-client';
import { useRealtime, applyTaskEvent } from '@/lib/realtime';
import {
  COLUMN_WIDTH,
  COLLAPSED_WIDTH,
  allowedTargets,
  boardColumns,
  isAllowedTarget,
  overflowCues,
  readBoardPrefs,
  statusDotClass,
  writeBoardPrefs,
  type BoardPrefs,
  type OverflowCues,
} from '@/lib/board';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, EmptyState } from '@/components/ui';
import { SkeletonColumn } from '@/components/Skeleton';
import { BoardColumn } from '@/components/board/BoardColumn';
import { publishLiveStatus, clearLiveStatus } from '@/components/live-status';
import {
  IconAlert,
  IconChevronRight,
  IconClose,
  IconDependencies,
  IconPlus,
  IconSearch,
} from '@/components/icons';

type Priority = 'low' | 'medium' | 'high';

const INPUT_CLASS =
  'h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] text-ink placeholder:text-muted transition duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const SELECT_CLASS =
  'h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13px] text-ink transition duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const GHOST_ICON_BUTTON =
  'grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted transition duration-150 hover:bg-surface-2 hover:text-ink';

interface MoveNotice {
  message: string;
  hint?: string;
  allowed: string[];
}

interface DraggingCard {
  taskId: string;
  from: string;
}

const EDGE_SCROLL_ZONE = 80;
const EDGE_SCROLL_STEP = 24;

export default function TasksPage() {
  const [project, setProject] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [closeStatus, setCloseStatus] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<Record<string, string[]> | null>(null);
  const [prefs, setPrefs] = useState<BoardPrefs>({ collapsed: [], hidden: [] });
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
  const [dragging, setDragging] = useState<DraggingCard | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<MoveNotice | null>(null);
  const [showDag, setShowDag] = useState(false);
  const [dag, setDag] = useState<DagData | null>(null);
  const [cues, setCues] = useState<OverflowCues>({
    left: false,
    right: false,
    hiddenLeft: 0,
    hiddenRight: 0,
  });
  const dragCounter = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const loadTasks = useCallback(async (currentProject: string, quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const data = await api.tasks.list(currentProject);
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Load the project first, then tasks/statuses/transitions for it. Statuses
  // failing must not hide the tasks: the board still renders a column per task
  // status (marked "not in project") so the page stays usable.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const current = await api.projects.getCurrent();
        const currentProject = current.project;
        if (!alive) return;
        setProject(currentProject);

        const [taskResult, statusResult, transitionResult] = await Promise.allSettled([
          api.tasks.list(currentProject),
          api.projects.statuses.get(currentProject),
          api.projects.transitions.get(currentProject),
        ]);
        if (!alive) return;

        if (taskResult.status === 'fulfilled') {
          setTasks(Array.isArray(taskResult.value) ? taskResult.value : []);
        } else {
          setError((taskResult.reason as Error).message);
        }

        if (statusResult.status === 'fulfilled') {
          setStatuses(statusResult.value.statuses);
          setCloseStatus(statusResult.value.closeStatus);
        } else {
          setStatuses([]);
          setError((statusResult.reason as Error).message);
        }

        setTransitions(
          transitionResult.status === 'fulfilled' ? transitionResult.value.transitions : null,
        );
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Hydrate column prefs once the project is known. Writes happen only from
  // the collapse/hide handlers, never during hydration.
  useEffect(() => {
    if (!project) return;
    setPrefs(readBoardPrefs(project));
  }, [project]);

  const columns = useMemo(() => boardColumns(statuses, prefs), [statuses, prefs]);

  const unknownStatuses = useMemo<ProjectStatus[]>(() => {
    const known = new Set(statuses.map((status) => status.id));
    const ids: string[] = [];
    for (const task of tasks) {
      if (!known.has(task.status) && !ids.includes(task.status)) ids.push(task.status);
    }
    return ids.map((id, index) => ({
      id,
      label: `${id} (not in project)`,
      category: 'todo' as const,
      order: 1000 + index,
    }));
  }, [tasks, statuses]);

  const visibleColumns = useMemo(
    () => [...columns.visible, ...unknownStatuses],
    [columns.visible, unknownStatuses],
  );

  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  const moveTargets = useCallback(
    (task: Task): ProjectStatus[] =>
      allowedTargets(transitions, task.status, statuses)
        .map((id) => statusById.get(id))
        .filter((status): status is ProjectStatus => Boolean(status)),
    [transitions, statuses, statusById],
  );

  const dragTargets = useMemo(
    () => new Set(dragging ? allowedTargets(transitions, dragging.from, statuses) : []),
    [dragging, transitions, statuses],
  );

  const draggingAllowedLabels = useMemo(
    () =>
      dragging
        ? allowedTargets(transitions, dragging.from, statuses).map(
            (id) => statusById.get(id)?.label ?? id,
          )
        : [],
    [dragging, transitions, statuses, statusById],
  );

  const columnWidths = useMemo(
    () =>
      visibleColumns.map((status) =>
        columns.collapsed.has(status.id) ? COLLAPSED_WIDTH : COLUMN_WIDTH,
      ),
    [visibleColumns, columns.collapsed],
  );

  const recomputeCues = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCues(overflowCues(el.scrollLeft, el.clientWidth, columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    recomputeCues();
  }, [recomputeCues, loading]);

  useEffect(() => {
    const onResize = () => recomputeCues();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recomputeCues]);

  function persistPrefs(next: BoardPrefs) {
    setPrefs(next);
    if (project) writeBoardPrefs(project, next);
  }

  function toggleCollapse(id: string) {
    const collapsed = prefs.collapsed.includes(id)
      ? prefs.collapsed.filter((value) => value !== id)
      : [...prefs.collapsed, id];
    persistPrefs({ ...prefs, collapsed });
  }

  function hideColumn(id: string) {
    persistPrefs({
      collapsed: prefs.collapsed.filter((value) => value !== id),
      hidden: prefs.hidden.includes(id) ? prefs.hidden : [...prefs.hidden, id],
    });
  }

  function showColumn(id: string) {
    persistPrefs({ ...prefs, hidden: prefs.hidden.filter((value) => value !== id) });
  }

  async function createTask() {
    if (!newTitle.trim()) return;
    try {
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
      const created = await api.tasks.create({
        project: project ?? undefined,
        title: newTitle,
        priority: newPriority,
        tags,
      });
      publish('task.created', created as unknown as Record<string, unknown>);
      setNewTitle('');
      setNewTags('');
      setNewPriority('medium');
      setShowCreate(false);
      if (project) await loadTasks(project, true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function closeTask(id: string) {
    if (!project) return;
    try {
      const closed = await api.tasks.close(project, id);
      publish('task.closed', closed as unknown as Record<string, unknown>);
      await loadTasks(project, true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /**
   * The single move path for drag & drop and the keyboard menu. The server is
   * the source of truth: a locally allowed move is applied optimistically and
   * reconciled with the response; a rejection (local or server) rolls the card
   * back, shows the server's reason + allowed list and refetches once.
   */
  async function moveTask(task: Task, to: string, droppable = true) {
    if (!project) return;
    const from = task.status;
    if (from === to) return;
    const locallyAllowed = droppable && isAllowedTarget(transitions, from, to, statuses);

    setMoveNotice(null);
    if (locallyAllowed) {
      setTasks((prev) => prev.map((item) => (item.id === task.id ? { ...item, status: to } : item)));
    }

    try {
      const updated = await api.tasks.update(project, task.id, { status: to });
      publish('task.updated', updated as unknown as Record<string, unknown>);
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
    } catch (e) {
      if (locallyAllowed) {
        setTasks((prev) =>
          prev.map((item) => (item.id === task.id ? { ...item, status: from } : item)),
        );
      }
      const toolError = e instanceof ToolCallError ? e : null;
      const details = toolError?.details as { allowed?: unknown } | undefined;
      const serverAllowed = Array.isArray(details?.allowed)
        ? details.allowed.filter((value): value is string => typeof value === 'string')
        : [];
      const allowedIds =
        serverAllowed.length > 0 ? serverAllowed : allowedTargets(transitions, from, statuses);
      setMoveNotice({
        message: toolError?.message ?? (e as Error).message,
        hint: toolError?.hint,
        allowed: allowedIds.map((id) => statusById.get(id)?.label ?? id),
      });
      await loadTasks(project, true);
    }
  }

  async function saveEdit() {
    if (!editingTask || !project) return;
    try {
      const updated = await api.tasks.update(project, editingTask.id, {
        title: editingTask.title,
        priority: editingTask.priority,
        tags: editingTask.tags,
      });
      publish('task.updated', updated as unknown as Record<string, unknown>);
      setEditingTask(null);
      await loadTasks(project, true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleDag() {
    if (!showDag && !dag) {
      try {
        setDag(await api.tasks.dag(project ?? undefined));
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setShowDag(!showDag);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>, task: Task) {
    setDragging({ taskId: task.id, from: task.status });
    setMoveNotice(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
  }

  function handleDragEnd() {
    dragCounter.current = 0;
    setDragging(null);
    setHoverCol(null);
  }

  function handleDragEnter() {
    dragCounter.current += 1;
  }

  function handleDragLeave() {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setHoverCol(null);
    }
  }

  function autoScrollBoard(event: React.DragEvent<HTMLElement>) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (event.clientX - rect.left < EDGE_SCROLL_ZONE) el.scrollLeft -= EDGE_SCROLL_STEP;
    else if (rect.right - event.clientX < EDGE_SCROLL_ZONE) el.scrollLeft += EDGE_SCROLL_STEP;
  }

  function handleColumnDragOver(
    event: React.DragEvent<HTMLElement>,
    columnId: string,
    droppable: boolean,
  ) {
    if (!dragging) return;
    autoScrollBoard(event);
    setHoverCol(columnId);
    const allowed = droppable && dragTargets.has(columnId);
    if (allowed) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    } else {
      // No preventDefault: the browser shows the no-drop cursor for forbidden
      // columns. The drop handler still runs if a drop is forced.
      event.dataTransfer.dropEffect = 'none';
    }
  }

  function handleColumnDrop(
    event: React.DragEvent<HTMLElement>,
    columnId: string,
    droppable: boolean,
  ) {
    event.preventDefault();
    dragCounter.current = 0;
    setHoverCol(null);
    const current = dragging;
    setDragging(null);
    if (!current || current.from === columnId) return;
    const task = tasks.find((item) => item.id === current.taskId);
    if (!task) return;
    void moveTask(task, columnId, droppable);
  }

  function scrollBoard(direction: -1 | 1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  }

  const allTags = Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort();

  const filtered = tasks.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterTag && !(t.tags ?? []).includes(filterTag)) return false;
    return true;
  });

  const filtersActive = Boolean(searchQuery) || filterPriority !== 'all' || Boolean(filterTag);
  const countFor = (statusId: string) => filtered.filter((task) => task.status === statusId).length;
  const skeletonStatuses = statuses.filter((status) => !status.archived).slice(0, 6);

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
            onKeyDown={(e) => e.key === 'Enter' && void createTask()}
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
            <Button type="button" variant="primary" onClick={() => void createTask()}>
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
              onChange={(e) =>
                setEditingTask({ ...editingTask, priority: e.target.value as Priority })
              }
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
                  tags: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="tags"
              className={`${INPUT_CLASS} sm:flex-1`}
              aria-label="Tags"
            />
            <Button type="button" variant="primary" onClick={() => void saveEdit()}>
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
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        {!loading && (
          <p className="px-1 text-[11px] text-muted sm:shrink-0">
            Showing <span className="font-medium text-ink">{filtered.length}</span> of{' '}
            {tasks.length} tasks
          </p>
        )}
      </div>

      {columns.hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Show hidden
          </span>
          {columns.hidden.map((status) => (
            <button
              key={status.id}
              type="button"
              onClick={() => showColumn(status.id)}
              aria-label={`Show ${status.label} column`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink transition duration-150 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`}
                aria-hidden="true"
              />
              {status.label}
              <span className="font-mono tabular-nums text-muted">· {countFor(status.id)}</span>
            </button>
          ))}
        </div>
      )}

      {moveNotice && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 px-3 py-2.5 text-[12px]"
        >
          <div className="flex items-start gap-2">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div>
              <p className="font-semibold text-danger">{moveNotice.message}</p>
              {moveNotice.hint && <p className="mt-0.5 text-muted">{moveNotice.hint}</p>}
              {moveNotice.allowed.length > 0 && (
                <p className="mt-0.5 text-muted">Allowed: {moveNotice.allowed.join(', ')}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMoveNotice(null)}
            aria-label="Dismiss move notice"
            className="rounded-[var(--radius-control)] p-0.5 text-muted transition duration-150 hover:bg-surface hover:text-ink"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {(skeletonStatuses.length > 0
            ? skeletonStatuses
            : [
                { id: 'one', label: 'One', category: 'todo' as const },
                { id: 'two', label: 'Two', category: 'todo' as const },
                { id: 'three', label: 'Three', category: 'todo' as const },
                { id: 'four', label: 'Four', category: 'todo' as const },
              ]
          ).map((status) => (
            <div key={status.id} className="w-[264px] shrink-0">
              <SkeletonColumn />
            </div>
          ))}
        </div>
      ) : (
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={recomputeCues}
            tabIndex={0}
            role="region"
            aria-label="Task board columns"
            className="flex max-h-[calc(100dvh-21rem)] min-h-[360px] snap-x gap-3 overflow-auto overscroll-contain pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:max-h-[calc(100dvh-18rem)]"
          >
            {visibleColumns.map((column) => {
              const columnTasks = filtered.filter((task) => task.status === column.id);
              const unknown = unknownStatuses.some((status) => status.id === column.id);
              const droppable = !unknown;
              const isSource = dragging?.from === column.id;
              const dropAllowed =
                Boolean(dragging) && !isSource && droppable && dragTargets.has(column.id);
              const dropDenied = Boolean(dragging) && !isSource && !dropAllowed;
              return (
                <BoardColumn
                  key={column.id}
                  status={column}
                  tasks={columnTasks}
                  collapsed={columns.collapsed.has(column.id)}
                  dragActive={Boolean(dragging)}
                  dropAllowed={dropAllowed}
                  dropDenied={dropDenied}
                  hovered={hoverCol === column.id}
                  draggingTaskId={dragging?.taskId ?? null}
                  droppable={droppable}
                  allowedLabels={draggingAllowedLabels}
                  moveTargets={moveTargets}
                  onCollapse={() => toggleCollapse(column.id)}
                  onExpand={() => toggleCollapse(column.id)}
                  onHide={() => hideColumn(column.id)}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={(event) =>
                    handleColumnDragOver(event, column.id, droppable)
                  }
                  onDrop={(event) => handleColumnDrop(event, column.id, droppable)}
                  onMove={(task, to) => void moveTask(task, to, droppable)}
                  onEdit={(task) => setEditingTask({ ...task })}
                  onClose={(task) => void closeTask(task.id)}
                  closeStatusId={closeStatus}
                  filtersActive={filtersActive}
                  totalTasks={tasks.length}
                />
              );
            })}

            {visibleColumns.length === 0 && (
              <div className="w-full">
                <EmptyState
                  title="No columns to show"
                  hint={
                    columns.hidden.length > 0
                      ? 'Every column is hidden — restore one from “Show hidden”.'
                      : 'This project has no statuses yet.'
                  }
                />
              </div>
            )}
          </div>

          {cues.left && (
            <button
              type="button"
              onClick={() => scrollBoard(-1)}
              aria-label={
                cues.hiddenLeft > 0 ? `Scroll left: ${cues.hiddenLeft} more columns` : 'Scroll left'
              }
              className="absolute bottom-0 left-0 top-0 z-20 flex w-9 items-center justify-center gap-0.5 rounded-l-[var(--radius-card)] bg-gradient-to-r from-canvas to-transparent text-muted transition duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <IconChevronRight className="h-4 w-4 rotate-180" />
              {cues.hiddenLeft > 0 && (
                <span className="font-mono text-[11px] tabular-nums">{cues.hiddenLeft}</span>
              )}
            </button>
          )}
          {cues.right && (
            <button
              type="button"
              onClick={() => scrollBoard(1)}
              aria-label={
                cues.hiddenRight > 0 ? `Scroll right: ${cues.hiddenRight} more columns` : 'Scroll right'
              }
              className="absolute bottom-0 right-4 top-0 z-20 flex w-9 items-center justify-center gap-0.5 rounded-r-[var(--radius-card)] bg-gradient-to-l from-canvas to-transparent text-muted transition duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {cues.hiddenRight > 0 && (
                <span className="font-mono text-[11px] tabular-nums">{cues.hiddenRight}</span>
              )}
              <IconChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
