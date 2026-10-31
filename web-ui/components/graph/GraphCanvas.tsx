'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphMode, GraphNode } from '@/lib/graph-model';
import {
  labelText,
  measureLabel,
  placeLabels,
  type LabelBox,
} from '@/lib/graph-labels';
import type { GraphPalette } from '@/lib/graph-theme';
import { truncateLabel } from '@/lib/graph-model';

export const GRAPH_WIDTH = 1000;
export const GRAPH_HEIGHT = 620;
export const GRAPH_PADDING = 36;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const GRAPH_CENTRE = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };

const LABEL_FONT_SIZE = 13;
const LABEL_PADDING = 6;
const PAN_STEP = 40;

export type PositionedNode = GraphNode & { x: number; y: number };

/** Entity radius grows with the number of facts; facts stay small. */
export function graphNodeRadius(node: GraphNode): number {
  if (node.type !== 'entity') return 5;
  return 7 + Math.min(14, 3 * Math.sqrt(Math.max(0, node.factCount)));
}

function adhocLabelBox(node: PositionedNode, fontSize: number): LabelBox {
  const text = labelText(node);
  const size = measureLabel(text, fontSize);
  const radius = graphNodeRadius(node);
  let x = node.x - size.width / 2;
  let y = node.y + radius + 2;
  x = Math.max(LABEL_PADDING, Math.min(x, GRAPH_WIDTH - LABEL_PADDING - size.width));
  if (y + size.height > GRAPH_HEIGHT - LABEL_PADDING) {
    y = node.y - radius - 2 - size.height;
  }
  y = Math.max(LABEL_PADDING, y);
  return { nodeId: node.id, text, x, y, width: size.width, height: size.height, visible: true };
}

export interface GraphCanvasProps {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  mode: GraphMode;
  palette: GraphPalette;
  selectedId: string | null;
  focusIds: Set<string> | null;
  matchIds: Set<string> | null;
  showFactLabels: boolean;
  zoom: number;
  pan: { x: number; y: number };
  onSelect: (id: string | null) => void;
  onZoomAt: (zoom: number, pivot: { x: number; y: number }) => void;
  onPan: (delta: { x: number; y: number }) => void;
  onReset: () => void;
}

/**
 * The graph surface: SVG edges, nodes and collision-free labels plus pointer,
 * wheel and keyboard navigation. All graph colours come from the runtime
 * palette (semantic CSS tokens), never from literal colours.
 */
export function GraphCanvas({
  nodes,
  edges,
  mode,
  palette,
  selectedId,
  focusIds,
  matchIds,
  showFactLabels,
  zoom,
  pan,
  onSelect,
  onZoomAt,
  onPan,
  onReset,
}: GraphCanvasProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  // Labels keep a constant on-screen size: the SVG group scales with zoom, so
  // the label font shrinks in user units as the graph grows. Each half-step of
  // zoom is a new placement pass, which is also how collided labels reappear.
  const labelBucket = useMemo(() => {
    const step = Math.round(zoom * 2) / 2;
    return Math.min(3, Math.max(1, step));
  }, [zoom]);
  const labelFontSize = LABEL_FONT_SIZE / labelBucket;

  const placedLabels = useMemo(
    () =>
      placeLabels(nodes, {
        width: GRAPH_WIDTH,
        height: GRAPH_HEIGHT,
        padding: LABEL_PADDING,
        fontSize: labelFontSize,
        nodeRadius: graphNodeRadius,
        maxLabels: 200,
        include: (node) => showFactLabels || node.type === 'entity',
      }),
    [nodes, showFactLabels, labelBucket, labelFontSize],
  );

  const renderedLabels = useMemo(() => {
    const boxes = new Map(placedLabels.map((box) => [box.nodeId, box]));
    const output: Array<LabelBox & { opacity: number; selected: boolean }> = [];

    for (const node of nodes) {
      const isFact = node.type === 'fact';
      const matched = matchIds?.has(node.id) ?? false;
      const forced = node.id === selectedId || node.id === hoveredNodeId || matched;
      if (isFact && !showFactLabels && !forced) continue;
      if (focusIds && !focusIds.has(node.id) && node.id !== selectedId && !matched) continue;

      const known = boxes.get(node.id);
      const box = known?.visible ? known : forced ? adhocLabelBox(node, labelFontSize) : null;
      if (!box) continue;

      output.push({
        ...box,
        opacity: matchIds && !matched ? 0.45 : 1,
        selected: node.id === selectedId,
      });
    }
    return output;
  }, [nodes, placedLabels, showFactLabels, selectedId, hoveredNodeId, matchIds, focusIds, labelFontSize]);

  const hoveredEdge = hoveredEdgeId ? (edges.find((edge) => edge.id === hoveredEdgeId) ?? null) : null;

  function nodeOpacity(id: string): number {
    // Search wins over focus: typing a query must reveal matches even when a
    // focus set from the previous selection is still active.
    if (matchIds) return matchIds.has(id) ? 1 : 0.25;
    if (focusIds) return focusIds.has(id) ? 1 : 0.15;
    return 1;
  }

  function edgeOpacity(edge: GraphEdge): number {
    // Single-mention co-occurrence is weak evidence: keep it faint so the
    // multi-fact relations (and their thicker strokes) carry the picture.
    const dense = nodes.length > 200;
    const base =
      mode === 'entities'
        ? Math.min(0.9, 0.22 + 0.16 * Math.max(1, edge.weight))
        : dense
          ? 0.35
          : 0.7;
    if (matchIds) {
      return matchIds.has(edge.source) || matchIds.has(edge.target) ? base : 0.25;
    }
    if (focusIds) {
      return focusIds.has(edge.source) && focusIds.has(edge.target) ? base : 0.08;
    }
    return base;
  }

  function edgeWidth(edge: GraphEdge): number {
    if (mode === 'facts') return 1;
    return 1 + Math.min(4, Math.max(0, Math.log2(Math.max(1, edge.weight))));
  }

  useEffect(() => {
    const element = containerRef.current;
    const svg = svgRef.current;
    if (!element || !svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const pivot = {
        x: ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT,
      };
      const factor = Math.exp(-event.deltaY * 0.0015);
      onZoomAt(zoom * factor, pivot);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoom, onZoomAt]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        onZoomAt(zoom * 1.2, GRAPH_CENTRE);
        break;
      case '-':
      case '_':
        event.preventDefault();
        onZoomAt(zoom / 1.2, GRAPH_CENTRE);
        break;
      case '0':
        event.preventDefault();
        onReset();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        onPan({ x: PAN_STEP / zoom, y: 0 });
        break;
      case 'ArrowRight':
        event.preventDefault();
        onPan({ x: -PAN_STEP / zoom, y: 0 });
        break;
      case 'ArrowUp':
        event.preventDefault();
        onPan({ x: 0, y: PAN_STEP / zoom });
        break;
      case 'ArrowDown':
        event.preventDefault();
        onPan({ x: 0, y: -PAN_STEP / zoom });
        break;
      default:
        break;
    }
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('[data-graph-node]')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onPan({
      x: ((event.clientX - drag.lastX) * (GRAPH_WIDTH / rect.width)) / zoom,
      y: ((event.clientY - drag.lastY) * (GRAPH_HEIGHT / rect.height)) / zoom,
    });
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
  }

  const accessibleLabel = `Knowledge graph: ${nodes.length} nodes, ${edges.length} edges, ${mode} mode`;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label="Graph canvas. Press plus or equals to zoom in, minus to zoom out, 0 to reset, arrow keys to pan."
      onKeyDown={handleKeyDown}
      className="relative rounded-[var(--radius-card)] bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="img"
        aria-label={accessibleLabel}
        className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            if (!source || !target) return null;
            const replaces = edge.kind === 'replaces';
            return (
              <g
                key={edge.id}
                onPointerEnter={() => setHoveredEdgeId(edge.id)}
                onPointerLeave={() => setHoveredEdgeId(null)}
              >
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={replaces ? palette.edgeReplaces : palette.edge}
                  strokeWidth={edgeWidth(edge)}
                  strokeDasharray={replaces ? '3 2' : undefined}
                  opacity={edgeOpacity(edge)}
                >
                  <title>
                    {replaces
                      ? 'replaces'
                      : mode === 'entities'
                        ? `${edge.weight} shared ${edge.weight === 1 ? 'fact' : 'facts'}`
                        : 'mentions'}
                  </title>
                </line>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="transparent"
                  strokeWidth={12}
                  pointerEvents="stroke"
                />
              </g>
            );
          })}

          {hoveredEdge && mode === 'entities' && nodesById.has(hoveredEdge.source) && nodesById.has(hoveredEdge.target) ? (
            <text
              x={(nodesById.get(hoveredEdge.source)!.x + nodesById.get(hoveredEdge.target)!.x) / 2}
              y={(nodesById.get(hoveredEdge.source)!.y + nodesById.get(hoveredEdge.target)!.y) / 2 - 4}
              textAnchor="middle"
              fontSize={labelFontSize}
              fill={palette.label}
              stroke={palette.nodeStroke}
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {hoveredEdge.weight} shared {hoveredEdge.weight === 1 ? 'fact' : 'facts'}
            </text>
          ) : null}

          {nodes.map((node) => {
            const radius = graphNodeRadius(node);
            const selected = node.id === selectedId;
            const matched = matchIds?.has(node.id) ?? false;
            const superseded = node.type === 'fact' && node.state === 'superseded';
            const fill =
              node.type === 'entity'
                ? palette.nodes.entity
                : superseded
                  ? palette.superseded
                  : palette.nodes.fact;
            return (
              <g
                key={node.id}
                data-graph-node={node.id}
                role="button"
                tabIndex={-1}
                aria-label={`${node.type === 'entity' ? 'Entity' : 'Fact'}: ${truncateLabel(node.label, 80)}`}
                opacity={nodeOpacity(node.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(node.id === selectedId ? null : node.id);
                }}
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={fill}
                  stroke={selected ? palette.selectedStroke : palette.nodeStroke}
                  strokeWidth={selected ? 2.5 : 1}
                  strokeDasharray={superseded ? '3 2' : undefined}
                />
                {matched ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius + 3}
                    fill="none"
                    stroke={palette.highlight}
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                ) : null}
              </g>
            );
          })}

          {renderedLabels.map((label) => (
            <text
              key={label.nodeId}
              x={label.x + label.width / 2}
              y={label.y + label.height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={labelFontSize}
              fontWeight={label.selected ? 600 : 400}
              fill={label.selected ? palette.selectedStroke : palette.label}
              opacity={label.opacity}
              pointerEvents="none"
            >
              {label.text}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
