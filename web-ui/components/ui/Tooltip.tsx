'use client';

import { useId, type ReactNode } from 'react';

/** Minimal accessible tooltip: shows on hover and keyboard focus. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[11px] text-ink opacity-0 shadow-pop transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
