/**
 * web-ui/components/board/CollapsedStatusStrip.tsx — the 48px collapsed column.
 *
 * One strip per collapsed status, spanning every grid row (header + all lanes)
 * exactly like the night-desk mockup: vertical label, count, expand control and
 * no cards anywhere in that column. The strip paints above the lane bands so it
 * reads as one continuous column while the lanes scroll under it.
 */

import type { CSSProperties } from 'react';
import type { ProjectStatus } from '../../lib/api-client';
import { statusDotClass } from '../../lib/board';
import { Button } from '../ui';
import { IconChevronRight } from '../icons';

const STRIP_BUTTON =
  'grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted transition duration-150 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export interface CollapsedStatusStripProps {
  status: ProjectStatus;
  /** Cards in this status across every lane. */
  count: number;
  style?: CSSProperties;
  onExpand: () => void;
}

export function CollapsedStatusStrip({ status, count, style, onExpand }: CollapsedStatusStripProps) {
  return (
    <section
      style={style}
      data-status={status.id}
      data-collapsed="true"
      data-slot="collapsed-strip"
      aria-label={`${status.label} column (collapsed)`}
      className="z-20 flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface-2 py-2"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Expand ${status.label} column`}
        aria-expanded="false"
        onClick={onExpand}
        className={STRIP_BUTTON}
      >
        <IconChevronRight className="h-3.5 w-3.5" />
      </Button>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(status)}`}
        aria-hidden="true"
      />
      <span className="[writing-mode:vertical-rl] text-[12px] font-medium tracking-[0.02em] text-ink">
        {status.label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
    </section>
  );
}
