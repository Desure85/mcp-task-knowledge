/**
 * web-ui/components/EmptyState.tsx — Empty column / empty result state.
 */

import type { ComponentType, ReactNode } from 'react';
import { IconInbox } from './icons';

type EmptyStateProps = {
  title: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  compact?: boolean;
  action?: ReactNode;
};

export function EmptyState({ title, hint, icon: Icon = IconInbox, compact = false, action }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 text-center ${
        compact ? 'gap-1 px-3 py-6' : 'gap-2 px-6 py-12'
      }`}
    >
      <Icon className={compact ? 'h-4 w-4 text-neutral-300' : 'h-5 w-5 text-neutral-300'} />
      <p className={`font-medium text-neutral-500 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{title}</p>
      {hint && <p className="max-w-xs text-[11px] text-neutral-400">{hint}</p>}
      {action}
    </div>
  );
}
