/**
 * web-ui/components/Badge.tsx — Small label pill.
 *
 * Priorities are NOT badges (see PriorityDot) — badges are for counts,
 * tags and neutral metadata only.
 */

import type { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'indigo' | 'success' | 'warning' | 'danger';

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
};

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  indigo: 'bg-accent-soft text-accent',
  success: 'bg-surface-2 text-success',
  warning: 'bg-surface-2 text-warning',
  danger: 'bg-surface-2 text-danger',
};

export function Badge({ children, tone = 'neutral', className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px] leading-4 ${TONES[tone]} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}
