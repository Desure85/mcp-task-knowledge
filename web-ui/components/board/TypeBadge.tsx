/**
 * web-ui/components/board/TypeBadge.tsx — the small type chip on a card (V-05).
 *
 * Dot + glyph + label, all token-driven (`typeDotClass` → `bg-ty-*`, the label
 * sits in `text-ty-*`). Hook-free so the card renders on the server.
 */

import type { ProjectType, Task } from '../../lib/api-client';
import { DEFAULT_TASK_TYPE, typeDotClass } from '../../lib/board-lanes';
import { TypeIcon } from './TypeIcon';

export type TypeBadgeProps = {
  /** The project type this card belongs to (already resolved by the page). */
  type?: ProjectType;
  /** Fallback when the type is unknown (e.g. tasks with a retired type id). */
  task?: Pick<Task, 'type'>;
  compact?: boolean;
};

const TONE_TEXT: Record<string, string> = {
  'bg-ty-task': 'text-ty-task',
  'bg-ty-bug': 'text-ty-bug',
  'bg-ty-feature': 'text-ty-feature',
};

export function TypeBadge({ type, task, compact = false }: TypeBadgeProps) {
  const label = type?.label ?? (task?.type?.trim() || DEFAULT_TASK_TYPE);
  const dot = typeDotClass(type);
  const tone = TONE_TEXT[dot] ?? 'text-muted';

  return (
    <span
      data-type={type?.id ?? task?.type ?? DEFAULT_TASK_TYPE}
      title={`Type: ${label}`}
      className={`inline-flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 ${tone}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <TypeIcon type={type?.id} icon={type?.icon} />
      {!compact && <span className="truncate">{label}</span>}
    </span>
  );
}
