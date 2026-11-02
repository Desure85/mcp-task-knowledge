/**
 * web-ui/components/board/BoardColumn.tsx — one status lane of the V-04 board.
 *
 * Presentational on purpose: every hook (drag state, prefs, scrolling) lives in
 * the page, so this component renders on the server for the component test.
 * It also renders the 48px collapsed strip, the sticky lane header with
 * collapse/hide controls, the transition-aware drop affordances and the
 * per-card "Move to…" menu.
 */

import type { DragEvent } from 'react';
import type { ProjectStatus, Task } from '../../lib/api-client';
import { statusDotClass } from '../../lib/board';
import { PriorityDot } from '../PriorityDot';
import { IconChevronRight, IconEyeOff, IconInbox, IconSubtask } from '../icons';
import { MoveMenu } from './MoveMenu';

const HEADER_BUTTON =
  'grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted transition duration-150 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

const STRIP_BUTTON =
  'grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted transition duration-150 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export interface BoardColumnProps {
  status: ProjectStatus;
  /** Tasks already filtered by the page (search/priority/tag). */
  tasks: Task[];
  collapsed: boolean;
  /** A card is being dragged somewhere on the board. */
  dragActive: boolean;
  /** This column is a legal target for the dragged card. */
  dropAllowed: boolean;
  /** This column is not a legal target (or not a project status at all). */
  dropDenied: boolean;
  /** The drag pointer is currently over this column. */
  hovered: boolean;
  draggingTaskId: string | null;
  /** False for statuses that are not part of the project (unknown columns). */
  droppable: boolean;
  /** Allowed labels for the dragged card, shown in the denied notice. */
  allowedLabels: string[];
  /** Allowed target statuses for a given task (drives the MoveMenu). */
  moveTargets: (task: Task) => ProjectStatus[];
  onCollapse: () => void;
  onExpand: () => void;
  onHide: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, task: Task) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onMove: (task: Task, to: string) => void;
  onEdit: (task: Task) => void;
  onClose: (task: Task) => void;
  /** The project's close status: cards there do not offer "Close". */
  closeStatusId?: string | null;
  filtersActive: boolean;
  totalTasks: number;
}

export function BoardColumn({
  status,
  tasks,
  collapsed,
  dragActive,
  dropAllowed,
  dropDenied,
  hovered,
  draggingTaskId,
  droppable,
  allowedLabels,
  moveTargets,
  onCollapse,
  onExpand,
  onHide,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onMove,
  onEdit,
  onClose,
  closeStatusId,
  filtersActive,
  totalTasks,
}: BoardColumnProps) {
  const stateClass = dropDenied
    ? 'cursor-not-allowed border-line bg-surface-2 opacity-50'
    : dropAllowed && hovered
      ? 'border-accent bg-accent-soft ring-2 ring-accent/40'
      : dropAllowed
        ? 'border-accent/60 bg-surface-2'
        : 'border-line bg-surface-2';

  if (collapsed) {
    return (
      <section
        data-status={status.id}
        data-collapsed="true"
        data-drop={dragActive ? (dropDenied ? 'denied' : 'allowed') : undefined}
        aria-disabled={dropDenied || undefined}
        aria-label={`${status.label} column (collapsed)`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`flex w-12 shrink-0 snap-start flex-col items-center gap-2 rounded-[var(--radius-card)] border py-2 transition duration-150 ${stateClass}`}
      >
        <button
          type="button"
          aria-label={`Expand ${status.label}`}
          aria-expanded="false"
          onClick={onExpand}
          className={STRIP_BUTTON}
        >
          <IconChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="[writing-mode:vertical-rl] text-[12px] font-medium tracking-[0.02em] text-ink">
          {status.label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{tasks.length}</span>
      </section>
    );
  }

  return (
    <section
      data-status={status.id}
      data-drop={dragActive ? (dropDenied ? 'denied' : 'allowed') : undefined}
      aria-disabled={dropDenied || undefined}
      aria-label={`${status.label} column`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex w-[264px] shrink-0 snap-start flex-col rounded-[var(--radius-card)] border transition duration-150 ${stateClass}`}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-[var(--radius-card)] border-b border-line bg-surface-2 px-2.5 py-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(status)}`}
          aria-hidden="true"
        />
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{status.label}</h3>
        <span className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 tabular-nums text-muted">
          {tasks.length}
        </span>
        <button
          type="button"
          aria-label={`Collapse ${status.label}`}
          aria-expanded="true"
          onClick={onCollapse}
          className={HEADER_BUTTON}
        >
          <IconChevronRight className="h-3.5 w-3.5 rotate-180" />
        </button>
        <button
          type="button"
          aria-label={`Hide ${status.label}`}
          onClick={onHide}
          className={HEADER_BUTTON}
        >
          <IconEyeOff className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-2 p-2.5">
        {dropDenied && (
          <p className="rounded-[var(--radius-control)] border border-danger/40 bg-surface px-2 py-1.5 text-[11px] leading-snug">
            <span className="block font-semibold text-danger">
              Move to {status.label} is not allowed
            </span>
            {hovered && allowedLabels.length > 0 && (
              <span className="mt-0.5 block text-muted">Allowed: {allowedLabels.join(', ')}</span>
            )}
            {!droppable && (
              <span className="mt-0.5 block text-muted">
                This status is not defined in the current project.
              </span>
            )}
          </p>
        )}

        {tasks.map((task) => {
          const tags = task.tags ?? [];
          const targets = moveTargets(task);
          return (
            <article
              key={task.id}
              draggable
              onDragStart={(event) => onDragStart(event, task)}
              onDragEnd={onDragEnd}
              className={`group/card cursor-grab rounded-[var(--radius-control)] border border-line bg-surface p-3 transition duration-150 hover:border-line-strong active:cursor-grabbing ${
                draggingTaskId === task.id ? 'opacity-60' : ''
              }`}
            >
              <p
                role="button"
                tabIndex={0}
                className="line-clamp-2 cursor-pointer rounded text-[13px] font-medium leading-snug text-ink transition duration-150 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                onClick={() => onEdit(task)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onEdit(task);
                  }
                }}
              >
                {task.title}
              </p>

              {tags.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 text-muted">
                      +{tags.length - 3}
                    </span>
                  )}
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
                <div className="flex shrink-0 items-center gap-1">
                  <MoveMenu taskTitle={task.title} targets={targets} onMove={(to) => onMove(task, to)} />
                  {closeStatusId !== status.id && (
                    <button
                      type="button"
                      onClick={() => onClose(task)}
                      className="rounded-[var(--radius-control)] px-1.5 py-1 text-[11px] font-medium text-muted opacity-0 transition duration-150 hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring group-hover/card:opacity-100"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border border-dashed border-line px-3 py-6 text-center">
            <IconInbox className="h-4 w-4 text-muted" />
            <p className="text-[11px] font-medium text-ink">No tasks</p>
            {filtersActive && totalTasks > 0 && (
              <p className="max-w-xs text-[11px] text-muted">No matches for current filters</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
