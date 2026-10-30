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
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-neutral-300" />}
      </div>
      <p className="mt-2 text-[24px] font-semibold leading-none tracking-tight text-neutral-900 tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-2 text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}
