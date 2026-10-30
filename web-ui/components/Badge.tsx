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
  neutral: 'bg-neutral-100 text-neutral-600',
  indigo: 'bg-indigo-50 text-indigo-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
};

export function Badge({ children, tone = 'neutral', className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] leading-4 ${TONES[tone]} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}
