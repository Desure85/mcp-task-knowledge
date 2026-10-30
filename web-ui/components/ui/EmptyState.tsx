import type { ComponentType, ReactNode } from 'react';
import { IconInbox } from '@/components/icons';

export function EmptyState({
  title,
  hint,
  icon: Icon = IconInbox,
  compact = false,
  action,
}: {
  title: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  compact?: boolean;
  action?: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line text-center ${
        compact ? 'gap-1 px-3 py-6' : 'gap-2 px-6 py-12'
      }`}
    >
      <Icon className={compact ? 'h-4 w-4 text-muted' : 'h-5 w-5 text-muted'} />
      <p className={`font-medium text-ink ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{title}</p>
      {hint && <p className="max-w-xs text-[11px] text-muted">{hint}</p>}
      {action}
    </div>
  );
}
