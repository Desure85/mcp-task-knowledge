/**
 * Label placement for the knowledge-graph SVG.
 *
 * Greedy, deterministic and geometry-only: every candidate box is checked
 * against the canvas and against rectangles already taken (labels + node
 * circles). Losers are emitted with `visible: false` so the caller can still
 * draw a marker for them.
 */

import { truncateLabel, type GraphNode } from './graph-model';

export interface LabelBox {
  nodeId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaceLabelsOptions {
  width: number;
  height: number;
  fontSize?: number;
  charWidth?: number;
  lineHeight?: number;
  padding?: number;
  nodeRadius?: (node: GraphNode) => number;
  maxLabels?: number;
  /**
   * Only these nodes receive a label; every node still blocks space with its
   * circle, so an entity label can never sit on an unlabelled fact node.
   */
  include?: (node: GraphNode) => boolean;
}

const DEFAULT_FONT_SIZE = 11;
/** Average glyph advance (px) at `DEFAULT_FONT_SIZE`. */
const DEFAULT_CHAR_WIDTH = 6.1;
const DEFAULT_PADDING = 4;
const DEFAULT_RADIUS = 10;
const DEFAULT_MAX_LABELS = 80;
const FACT_LABEL_MAX = 40;
/** Gap between a circle and its label box. */
const GAP = 2;

/** Estimated text box for a single-line label. */
export function measureLabel(
  text: string,
  fontSize: number = DEFAULT_FONT_SIZE,
  charWidth: number = DEFAULT_CHAR_WIDTH,
): { width: number; height: number } {
  const scale = fontSize / DEFAULT_FONT_SIZE;
  return {
    width: Math.ceil(text.length * charWidth * scale),
    height: Math.ceil(fontSize * 1.25),
  };
}

/** Axis-aligned overlap test; touching edges do not count as overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Text drawn next to a node: entities keep the full name, facts are truncated. */
export function labelText(node: GraphNode): string {
  return node.type === 'fact' ? truncateLabel(node.label, FACT_LABEL_MAX) : node.label;
}

/** Layout merges `x`/`y` into nodes before labelling; only the circle centre is needed here. */
type PositionedNode = GraphNode & { x?: number; y?: number };

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function overlapsAny(box: Rect, taken: Rect[]): boolean {
  for (const rect of taken) if (rectsOverlap(box, rect)) return true;
  return false;
}

function insideCanvas(box: Rect, width: number, height: number, padding: number): boolean {
  return (
    box.x >= padding &&
    box.y >= padding &&
    box.x + box.width <= width - padding &&
    box.y + box.height <= height - padding
  );
}

/**
 * Place one label per node in priority order (degree, factCount, id).
 *
 * Candidate positions are tried below, above, right and left of the circle,
 * each also shifted left/right. The first one that fits inside the padded
 * canvas and touches nothing else wins; otherwise the box is hidden.
 */
export function placeLabels(nodes: GraphNode[], options: PlaceLabelsOptions): LabelBox[] {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const charWidth = options.charWidth ?? DEFAULT_CHAR_WIDTH;
  const padding = options.padding ?? DEFAULT_PADDING;
  const radiusOf = options.nodeRadius ?? (() => DEFAULT_RADIUS);
  const maxLabels = Math.max(0, Math.floor(options.maxLabels ?? DEFAULT_MAX_LABELS));
  const include = options.include ?? (() => true);

  const centreOf = (node: GraphNode): { x: number; y: number } => {
    const positioned = node as PositionedNode;
    return {
      x: finiteOr(positioned.x, width / 2),
      y: finiteOr(positioned.y, height / 2),
    };
  };

  const order = nodes
    .filter(include)
    .map((node, index) => ({ node, index }))
    .sort(
      (a, b) =>
        b.node.degree - a.node.degree ||
        b.node.factCount - a.node.factCount ||
        a.node.id.localeCompare(b.node.id) ||
        a.index - b.index,
    );

  const circles = nodes.map((node) => {
    const { x, y } = centreOf(node);
    const r = Math.max(0, radiusOf(node));
    return { nodeId: node.id, rect: { x: x - r, y: y - r, width: r * 2, height: r * 2 } };
  });

  const taken: Rect[] = [];
  const boxes = new Map<string, LabelBox>();
  let visibleCount = 0;

  for (const { node } of order) {
    const text = labelText(node);
    const size = measureLabel(text, fontSize, charWidth);
    const { x: cx, y: cy } = centreOf(node);
    const r = Math.max(0, radiusOf(node));

    const below = { x: cx - size.width / 2, y: cy + r + GAP };
    const above = { x: cx - size.width / 2, y: cy - r - GAP - size.height };
    const right = { x: cx + r + GAP, y: cy - size.height / 2 };
    const left = { x: cx - r - GAP - size.width, y: cy - size.height / 2 };

    const offset = size.width / 2 + GAP;
    const candidates: Array<{ x: number; y: number }> = [
      below,
      above,
      right,
      left,
      { x: below.x - offset, y: below.y },
      { x: below.x + offset, y: below.y },
      { x: above.x - offset, y: above.y },
      { x: above.x + offset, y: above.y },
      { x: right.x, y: right.y - size.height - GAP },
      { x: left.x, y: left.y - size.height - GAP },
    ];

    const obstacles = circles.filter((circle) => circle.nodeId !== node.id).map((circle) => circle.rect);

    let chosen: Rect | null = null;
    if (visibleCount < maxLabels) {
      for (const candidate of candidates) {
        const box: Rect = { x: candidate.x, y: candidate.y, width: size.width, height: size.height };
        if (!insideCanvas(box, width, height, padding)) continue;
        if (overlapsAny(box, taken)) continue;
        if (overlapsAny(box, obstacles)) continue;
        chosen = box;
        break;
      }
    }

    if (chosen) {
      taken.push(chosen);
      visibleCount += 1;
      boxes.set(node.id, {
        nodeId: node.id,
        text,
        x: chosen.x,
        y: chosen.y,
        width: chosen.width,
        height: chosen.height,
        visible: true,
      });
    } else {
      boxes.set(node.id, {
        nodeId: node.id,
        text,
        x: below.x,
        y: below.y,
        width: size.width,
        height: size.height,
        visible: false,
      });
    }
  }

  // Output preserves the caller's node order, never the priority order.
  return nodes.filter(include).map(
    (node) =>
      boxes.get(node.id) ?? {
        nodeId: node.id,
        text: labelText(node),
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
      },
  );
}
