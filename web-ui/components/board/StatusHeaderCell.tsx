/**
 * web-ui/components/board/StatusHeaderCell.tsx — one shared status header (V-05).
 *
 * The board has a single sticky header row: every lane repeats the same status
 * columns underneath, so the header cells are rendered once and pinned with
 * `position: sticky`. Collapse/hide stay exactly as in V-04; the grid position
 * is supplied by the page through `style`.
 */

import type { CSSProperties } from 'react';
import type { ProjectStatus } from '../../lib/api-client';
import { statusDotClass } from '../../lib/board';
import { IconChevronRight, IconEyeOff } from '../icons';

const HEADER_BUTTON =
  'grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted transition duration-150 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export interface StatusHeaderCellProps {
  status: ProjectStatus;
  /** Cards in this status across every lane (the shared header count). */
  count: number;
  style?: CSSProperties;
  onCollapse: () => void;
  onHide: () => void;
}

export function StatusHeaderCell({ status, count, style, onCollapse, onHide }: StatusHeaderCellProps) {
  return (
    <div
      style={style}
      data-status={status.id}
      data-slot="status-header"
      className="sticky top-0 z-30 flex items-center gap-2 rounded-t-[var(--radius-card)] border border-line bg-surface-2 px-2.5 py-2"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(status)}`}
        aria-hidden="true"
      />
      <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{status.label}</h3>
      <span className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface px-1.5 py-0.5 text-[11px] leading-4 tabular-nums text-muted">
        {count}
      </span>
      <button
        type="button"
        aria-label={`Collapse ${status.label} column`}
        aria-expanded="true"
        onClick={onCollapse}
        className={HEADER_BUTTON}
      >
        <IconChevronRight className="h-3.5 w-3.5 rotate-180" />
      </button>
      <button
        type="button"
        aria-label={`Hide ${status.label} column`}
        onClick={onHide}
        className={HEADER_BUTTON}
      >
        <IconEyeOff className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
