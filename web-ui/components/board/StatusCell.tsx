/**
 * web-ui/components/board/StatusCell.tsx — one (lane × status) drop target (V-05).
 *
 * Every lane repeats the same status columns, so a cell knows both coordinates:
 * the status it drops into and the lane it belongs to. A card may only move
 * between statuses inside its own lane — changing the type is the form's job,
 * so a cross-lane drop is refused with a plain reason instead of mutating the
 * task type silently.
 */

import type { CSSProperties, DragEvent } from 'react';
import type { ProjectStatus, ProjectType, Task } from '../../lib/api-client';
import { TaskCard } from './TaskCard';

export type CellDenyReason = 'type' | 'status';

export interface StatusCellProps {
  laneId: string;
  laneLabel: string;
  status: ProjectStatus;
  /** Cards in this lane and status, already filtered by the page. */
  tasks: Task[];
  style?: CSSProperties;
  dragActive: boolean;
  /** This cell accepts the dragged card. */
  dropAllowed: boolean;
  /** This cell refuses the dragged card. */
  dropDenied: boolean;
  /** Why it is refused — a different lane, or a forbidden/unknown status. */
  denyReason: CellDenyReason | null;
  /** The drag pointer is currently over this cell. */
  hovered: boolean;
  draggingTaskId: string | null;
  /** False for statuses that are not part of the project (unknown columns). */
  droppable: boolean;
  /** Allowed status labels for the dragged card, shown in the denied notice. */
  allowedLabels: string[];
  /** Project types, used to resolve the badge of every card. */
  types: ProjectType[];
  moveTargets: (task: Task) => ProjectStatus[];
  onDragStart: (event: DragEvent<HTMLElement>, task: Task) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onMove: (task: Task, to: string) => void;
  onEdit: (task: Task) => void;
  onView: (task: Task) => void;
  onClose: (task: Task) => void;
  closeStatusId?: string | null;
  filtersActive: boolean;
  totalTasks: number;
}

export function StatusCell({
  laneId,
  laneLabel,
  status,
  tasks,
  style,
  dragActive,
  dropAllowed,
  dropDenied,
  denyReason,
  hovered,
  draggingTaskId,
  droppable,
  allowedLabels,
  types,
  moveTargets,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onMove,
  onEdit,
  onView,
  onClose,
  closeStatusId,
  filtersActive,
  totalTasks,
}: StatusCellProps) {
  const typeById = new Map(types.map((type) => [type.id, type]));

  const stateClass = dropDenied
    ? 'cursor-not-allowed border-line bg-surface-2 opacity-50'
    : dropAllowed && hovered
      ? 'border-accent bg-accent-soft ring-2 ring-accent/40'
      : dropAllowed
        ? 'border-accent/60 bg-surface-2'
        : 'border-line bg-surface-2';

  return (
    <section
      style={style}
      data-status={status.id}
      data-lane={laneId}
      data-slot="status-cell"
      data-drop={dragActive ? (dropDenied ? 'denied' : 'allowed') : undefined}
      aria-disabled={dropDenied || undefined}
      aria-label={`${status.label} column, ${laneLabel} lane`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex min-h-[150px] flex-col gap-2 rounded-b-[var(--radius-card)] border border-t-0 p-2.5 transition duration-150 ${stateClass}`}
    >
      {dropDenied && denyReason === 'type' && hovered && (
        <p className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-[11px] leading-snug">
          <span className="block font-semibold text-ink">Change the type in the card form</span>
          <span className="mt-0.5 block text-muted">
            A card stays in its {laneLabel} lane while dragging.
          </span>
        </p>
      )}

      {dropDenied && denyReason === 'status' && (
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

      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          type={typeById.get((task.type ?? '').trim() || 'task')}
          dragging={draggingTaskId === task.id}
          targets={moveTargets(task)}
          closeStatusId={closeStatusId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onMove={onMove}
          onEdit={onEdit}
          onView={onView}
          onClose={onClose}
        />
      ))}

      {tasks.length === 0 && (
        <p className="px-1 py-1 text-[11px] text-muted">
          No tasks
          {filtersActive && totalTasks > 0 && (
            <span className="block text-muted">No matches for current filters</span>
          )}
        </p>
      )}
    </section>
  );
}
