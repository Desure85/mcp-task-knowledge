/**
 * web-ui/components/StatTile.tsx — Overview metric tile.
 */

import type { ComponentType, ReactNode } from 'react';

type StatTileProps = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
};

export function StatTile({ label, value, hint, icon: Icon }: StatTileProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted" />}
      </div>
      <p className="mt-2 text-[24px] font-semibold leading-none tracking-tight text-ink tnum">
        {value}
      </p>
      {hint && <p className="mt-2 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
