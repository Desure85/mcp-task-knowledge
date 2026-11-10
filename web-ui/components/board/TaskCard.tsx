/**
 * web-ui/components/board/TaskCard.tsx — one draggable task card (V-04 + V-05).
 *
 * Extracted from the old column so every lane cell renders the same card: type
 * badge, priority, tags, subtask marker, the keyboard "Move to…" menu and the
 * Close action. Hook-free — drag state lives in the page, which keeps the whole
 * board renderable on the server for the component test.
 */

import type { DragEvent } from 'react';
import type { ProjectStatus, ProjectType, Task } from '../../lib/api-client';
import { PriorityDot } from '../PriorityDot';
import { IconDependencies, IconSubtask } from '../icons';
import { Badge, Button } from '../ui';
import { MoveMenu } from './MoveMenu';
import { TypeBadge } from './TypeBadge';

export interface TaskCardProps {
  task: Task;
  /** Resolved project type for the badge (undefined for retired/unknown ids). */
  type?: ProjectType;
  dragging: boolean;
  /** Allowed target statuses for this card (drives the keyboard menu). */
  targets: ProjectStatus[];
  /** The project's close status: a card already there offers no "Close". */
  closeStatusId?: string | null;
  onDragStart: (event: DragEvent<HTMLElement>, task: Task) => void;
  onDragEnd: () => void;
  onMove: (task: Task, to: string) => void;
  onEdit: (task: Task) => void;
  onView: (task: Task) => void;
  onClose: (task: Task) => void;
}

export function TaskCard({
  task,
  type,
  dragging,
  targets,
  closeStatusId,
  onDragStart,
  onDragEnd,
  onMove,
  onEdit,
  onView,
  onClose,
}: TaskCardProps) {
  const tags = task.tags ?? [];

  return (
    <article
      data-task={task.id}
      tabIndex={0}
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, a, [role="button"]')) return;
        onView(task);
      }}
      className={`group/card cursor-grab rounded-[var(--radius-control)] border border-line bg-surface p-3 transition duration-150 hover:border-line-strong active:cursor-grabbing ${
        dragging ? 'opacity-60' : ''
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <TypeBadge type={type} task={task} />
        {task.parentId && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted" title="Subtask">
            <IconSubtask className="h-3 w-3" />
            Subtask
          </span>
        )}
      </div>

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

      {(task.onCriticalPath || (task.dependentsCount ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {task.onCriticalPath && (
            <Badge tone="doing" title="On the longest dependency chain">
              <IconDependencies className="mr-1 h-3 w-3" />
              Critical path
            </Badge>
          )}
          {(task.dependentsCount ?? 0) > 0 && (
            <Badge
              tone={(task.dependentsCount ?? 0) >= 3 ? 'blocked' : 'medium'}
              title={`${task.dependentsCount} tasks transitively depend on this one`}
            >
              <IconDependencies className="mr-1 h-3 w-3" />
              Blocks {task.dependentsCount}
            </Badge>
          )}
        </div>
      )}

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
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MoveMenu taskTitle={task.title} targets={targets} onMove={(to) => onMove(task, to)} />
          {closeStatusId !== task.status && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onClose(task)}
              className="h-6 px-1.5 text-[11px] opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100"
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
