/**
 * web-ui/components/board/LaneHeader.tsx — the full-width lane band (V-05).
 *
 * One band per task type: type glyph + label + count + collapse chevron. It
 * spans every status column and is pinned to the left edge while the board
 * scrolls horizontally, so the lane a card belongs to is always readable.
 * Hook-free and position-supplied by the page.
 */

import type { CSSProperties } from 'react';
import type { ProjectType } from '../../lib/api-client';
import { typeDotClass } from '../../lib/board-lanes';
import { IconChevronDown } from '../icons';
import { TypeIcon } from './TypeIcon';

export interface LaneHeaderProps {
  /** Lane id (`bug`, `feature`, … or the synthetic `other`). */
  laneId: string;
  label: string;
  count: number;
  collapsed: boolean;
  /** Project type, when the lane maps to one (absent for `other`). */
  type?: ProjectType;
  style?: CSSProperties;
  onToggle: () => void;
}

export function LaneHeader({
  laneId,
  label,
  count,
  collapsed,
  type,
  style,
  onToggle,
}: LaneHeaderProps) {
  const dot = typeDotClass(type);

  return (
    <div
      style={style}
      data-lane={laneId}
      data-slot="lane-header"
      data-collapsed={collapsed || undefined}
      className="sticky left-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-surface px-1"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label} lane`}
        onClick={onToggle}
        className="inline-flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-left transition duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <TypeIcon type={type?.id ?? laneId} icon={type?.icon} className="h-3.5 w-3.5 text-muted" />
        <span className="truncate text-[12px] font-semibold text-ink">{label}</span>
        <span className="inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] leading-4 tabular-nums text-muted">
          {count}
        </span>
        <IconChevronDown
          className={`h-3.5 w-3.5 text-muted transition duration-150 ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
    </div>
  );
}
