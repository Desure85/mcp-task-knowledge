'use client';

import type { GraphMode } from '@/lib/graph-model';
import type { GraphPalette } from '@/lib/graph-theme';

const ITEM = 'flex items-center gap-1.5';

/**
 * Visible, screen-reader-friendly key for the SVG. Swatches use the same
 * runtime palette as the canvas so the legend can never drift from it.
 */
export function Legend({ mode, palette }: { mode: GraphMode; palette: GraphPalette }) {
  return (
    <div
      data-mode={mode}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-2 text-[11px] text-muted"
    >
      <span className={ITEM}>
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: palette.nodes.entity }}
        />
        Entity
      </span>
      <span className={ITEM}>
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: palette.nodes.fact }}
        />
        Fact
      </span>
      <span className={ITEM}>
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-full border border-dashed"
          style={{ borderColor: palette.superseded }}
        />
        Superseded fact (dashed)
      </span>
      <span className={ITEM}>
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-4 rounded-full"
          style={{ backgroundColor: palette.edge }}
        />
        Edge: mentions
      </span>
      <span className={ITEM}>
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-4 rounded-full"
          style={{ backgroundColor: palette.edge }}
        />
        Edge: co-occurs (Entities mode)
      </span>
      <span className={ITEM}>
        <span
          aria-hidden="true"
          className="inline-block w-4 border-t border-dashed"
          style={{ borderColor: palette.edgeReplaces }}
        />
        Edge: replaces (dashed)
      </span>
      <span className={ITEM}>Thicker line = more shared facts</span>
    </div>
  );
}
