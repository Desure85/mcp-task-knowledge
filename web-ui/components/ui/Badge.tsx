import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'todo'
  | 'doing'
  | 'review'
  | 'blocked'
  | 'done'
  | 'bug'
  | 'feature'
  | 'task'
  | 'high'
  | 'medium'
  | 'low';

const TONES: Record<BadgeTone, string> = {
  neutral: 'text-muted',
  todo: 'text-st-todo',
  doing: 'text-st-doing',
  review: 'text-st-review',
  blocked: 'text-st-blocked',
  done: 'text-st-done',
  bug: 'text-ty-bug',
  feature: 'text-ty-feature',
  task: 'text-ty-task',
  high: 'text-pr-high',
  medium: 'text-pr-med',
  low: 'text-pr-low',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
