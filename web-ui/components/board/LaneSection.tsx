/**
 * web-ui/components/board/LaneSection.tsx — one lane row: band + its cells.
 *
 * Keeps the collapse rule in one place: a folded lane renders its band and no
 * status cells at all (the columns stay reserved by the grid), so "header only"
 * is the component's contract rather than a branch repeated in the page.
 * Hook-free; the page supplies each cell and its grid position.
 */

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { ProjectStatus, ProjectType } from '../../lib/api-client';
import { LaneHeader } from './LaneHeader';

export interface LaneSectionProps {
  laneId: string;
  label: string;
  count: number;
  collapsed: boolean;
  type?: ProjectType;
  /** Grid placement of the band; absent in single-board mode. */
  headerStyle?: CSSProperties;
  /** False for the single-lane board, which has no band at all. */
  showHeader: boolean;
  /** Statuses in board order — one cell per status, in the same order. */
  columns: ProjectStatus[];
  renderCell: (status: ProjectStatus, index: number) => ReactNode;
  onToggle: () => void;
}

export function LaneSection({
  laneId,
  label,
  count,
  collapsed,
  type,
  headerStyle,
  showHeader,
  columns,
  renderCell,
  onToggle,
}: LaneSectionProps) {
  return (
    <Fragment>
      {showHeader && (
        <LaneHeader
          laneId={laneId}
          label={label}
          count={count}
          collapsed={collapsed}
          type={type}
          style={headerStyle}
          onToggle={onToggle}
        />
      )}
      {!collapsed &&
        columns.map((status, index) => (
          <Fragment key={status.id}>{renderCell(status, index)}</Fragment>
        ))}
    </Fragment>
  );
}
