/**
 * web-ui/components/board/TypeMultiSelect.tsx — the type filter above the board.
 *
 * A native `<details>` disclosure (no state, renders on the server): one real
 * checkbox per project type with its token dot, an "All types" reset and the
 * "Show empty lanes" switch. The visible label adapts from `Types: 2 of 4` on
 * desktop to the compact `Types · 2` under 640px; both variants are in the DOM
 * and one is hidden by CSS, so SSR markup carries the right text for a test.
 */

import type { ProjectType } from '../../lib/api-client';
import { typeDotClass } from '../../lib/board-lanes';
import { IconChevronDown } from '../icons';
import { TypeIcon } from './TypeIcon';

export interface TypeMultiSelectProps {
  types: ProjectType[];
  /** Explicit stored selection; empty means "all types". */
  selected: string[];
  /** Ids the selection actually resolves to, in project order. */
  resolved: string[];
  showEmptyLanes: boolean;
  /** Optional per-type task count shown next to its label. */
  counts?: Record<string, number>;
  onToggleType: (id: string) => void;
  onSelectAll: () => void;
  onToggleShowEmpty: () => void;
}

export function TypeMultiSelect({
  types,
  selected,
  resolved,
  showEmptyLanes,
  counts,
  onToggleType,
  onSelectAll,
  onToggleShowEmpty,
}: TypeMultiSelectProps) {
  const all = selected.length === 0;
  const only = resolved.length === 1 ? types.find((type) => type.id === resolved[0]) : undefined;
  const desktopLabel = all
    ? 'Types: All'
    : only
      ? `Types: ${only.label}`
      : `Types: ${resolved.length} of ${types.length}`;
  const compactLabel = `Types · ${resolved.length}`;

  return (
    <details className="relative shrink-0" data-slot="type-multi-select">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-[13px] text-ink transition duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden">
        <span className="hidden sm:inline">{desktopLabel}</span>
        <span className="sm:hidden">{compactLabel}</span>
        <span className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] leading-4 tabular-nums text-muted">
          {resolved.length}
        </span>
        <IconChevronDown className="h-3.5 w-3.5 text-muted" />
      </summary>

      <div className="absolute left-0 z-40 mt-1 w-60 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--shadow-pop)]">
        <ul className="space-y-0.5">
          {types.map((type) => {
            const checked = resolved.includes(type.id);
            const count = counts?.[type.id];
            return (
              <li key={type.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[12px] text-ink transition duration-150 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    name="board-type"
                    value={type.id}
                    data-type={type.id}
                    checked={checked}
                    onChange={() => onToggleType(type.id)}
                    className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                  />
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${typeDotClass(type)}`}
                    aria-hidden="true"
                  />
                  <TypeIcon type={type.id} icon={type.icon} className="h-3.5 w-3.5 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{type.label}</span>
                  {typeof count === 'number' && (
                    <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5">
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-medium text-muted transition duration-150 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            All types
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-muted">
            <input
              type="checkbox"
              name="board-show-empty-lanes"
              checked={showEmptyLanes}
              onChange={onToggleShowEmpty}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
            />
            Show empty lanes
          </label>
        </div>
      </div>
    </details>
  );
}
