'use client';

import type { GraphMode } from '@/lib/graph-model';
import { cn } from '@/lib/cn';

const OPTIONS: Array<{ value: GraphMode; label: string }> = [
  { value: 'entities', label: 'Entities' },
  { value: 'facts', label: 'Facts & entities' },
];

/**
 * Segmented radio group for the graph mode. Real `<input type="radio">`
 * controls inside a fieldset keep the keyboard and screen-reader contract
 * native; the visible pill is styled from the current mode.
 */
export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: GraphMode;
  onChange: (mode: GraphMode) => void;
}) {
  return (
    <fieldset className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-surface p-0.5">
      <legend className="sr-only">Graph mode</legend>
      {OPTIONS.map((option) => {
        const active = mode === option.value;
        return (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name="graph-mode"
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex rounded-[var(--radius-control)] px-2.5 py-1 text-[12px] font-medium transition',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-canvas',
                active ? 'bg-accent text-on-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
