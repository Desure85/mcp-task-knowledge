/**
 * Geometry tests for greedy label placement.
 */

import { describe, it, expect } from 'vitest';
import type { GraphNode } from './graph-model';
import {
  labelText,
  measureLabel,
  placeLabels,
  rectsOverlap,
  type LabelBox,
  type PlaceLabelsOptions,
  type Rect,
} from './graph-labels';

type PositionedNode = GraphNode & { x: number; y: number };

function node(over: Partial<GraphNode> & { id: string; x: number; y: number }): PositionedNode {
  const { x, y, ...rest } = over;
  return {
    id: rest.id,
    label: rest.label ?? rest.id.replace(/^(entity|fact):/, ''),
    type: rest.type ?? 'entity',
    factCount: rest.factCount ?? 1,
    degree: rest.degree ?? 0,
    x,
    y,
    ...(rest.entity === undefined ? {} : { entity: rest.entity }),
    ...(rest.factId === undefined ? {} : { factId: rest.factId }),
  };
}

function grid(count: number, width: number, height: number): PositionedNode[] {
  const columns = Math.ceil(Math.sqrt(count));
  const stepX = width / (columns + 1);
  const rows = Math.ceil(count / columns);
  const stepY = height / (rows + 1);
  const nodes: PositionedNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    nodes.push(
      node({
        id: `entity:n${String(i).padStart(2, '0')}`,
        label: `node number ${i}`,
        x: stepX * (col + 1),
        y: stepY * (row + 1),
        degree: i,
        factCount: i % 4,
      }),
    );
  }
  return nodes;
}

/** Tightly packed cluster: naive first-candidate placement overlaps here. */
function packed(count: number, step: number, originX: number, originY: number): PositionedNode[] {
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) =>
    node({
      id: `entity:p${String(i).padStart(2, '0')}`,
      label: `packed label ${i}`,
      x: originX + (i % columns) * step,
      y: originY + Math.floor(i / columns) * step,
      degree: i,
      factCount: i % 3,
    }),
  );
}

const OPTIONS: PlaceLabelsOptions = { width: 800, height: 600 };

function visible(boxes: LabelBox[]): LabelBox[] {
  return boxes.filter((box) => box.visible);
}

function boxRect(box: LabelBox): Rect {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function circleRect(n: PositionedNode, radius = 10): Rect {
  return { x: n.x - radius, y: n.y - radius, width: radius * 2, height: radius * 2 };
}

describe('graph-labels: primitives', () => {
  it('measures text proportionally to font size', () => {
    const small = measureLabel('abcdefghij');
    const large = measureLabel('abcdefghij', 22);
    expect(small.width).toBeGreaterThan(0);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
    expect(measureLabel('').width).toBe(0);
  });

  it('treats touching edges as non-overlapping', () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 9.9, y: 0, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 0, y: 2, width: 5, height: 5 })).toBe(true);
  });

  it('truncates fact labels to 40 characters and keeps entity labels whole', () => {
    const longStatement = 'A very long fact statement that keeps going well past forty characters in total length';
    const factNode = node({ id: 'fact:f1', type: 'fact', label: longStatement, x: 100, y: 100 });
    const entityNode = node({ id: 'entity:A', type: 'entity', label: longStatement, x: 100, y: 100 });
    expect(labelText(factNode).length).toBeLessThanOrEqual(41);
    expect(labelText(factNode).endsWith('\u2026')).toBe(true);
    expect(labelText(entityNode)).toBe(longStatement);
  });
});

describe('graph-labels: placeLabels', () => {
  it('keeps visible boxes inside the padded canvas', () => {
    const nodes = grid(36, OPTIONS.width, OPTIONS.height);
    const boxes = placeLabels(nodes, { ...OPTIONS, padding: 4 });
    for (const box of visible(boxes)) {
      expect(box.x).toBeGreaterThanOrEqual(4);
      expect(box.y).toBeGreaterThanOrEqual(4);
      expect(box.x + box.width).toBeLessThanOrEqual(OPTIONS.width - 4);
      expect(box.y + box.height).toBeLessThanOrEqual(OPTIONS.height - 4);
    }
    expect(visible(boxes).length).toBeGreaterThan(0);
  });

  it('never overlaps two visible boxes', () => {
    const nodes = [...grid(49, OPTIONS.width, OPTIONS.height), ...packed(25, 26, 200, 200)];
    const boxes = visible(placeLabels(nodes, OPTIONS));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(
          rectsOverlap(boxRect(boxes[i]), boxRect(boxes[j])),
          `${boxes[i].nodeId} overlaps ${boxes[j].nodeId}`,
        ).toBe(false);
      }
    }
  });

  it('never overlaps another node circle', () => {
    const nodes = [...grid(25, OPTIONS.width, OPTIONS.height), ...packed(25, 24, 300, 300)];
    const boxes = visible(placeLabels(nodes, OPTIONS));
    for (const box of boxes) {
      for (const other of nodes) {
        if (other.id === box.nodeId) continue;
        expect(rectsOverlap(boxRect(box), circleRect(other))).toBe(false);
      }
    }
  });

  it('gives the label to the higher-degree node when two nodes collide', () => {
    const nodes = [
      node({ id: 'entity:low', label: 'low degree', x: 400, y: 300, degree: 1, factCount: 1 }),
      node({ id: 'entity:high', label: 'high degree', x: 400, y: 300, degree: 9, factCount: 9 }),
    ];
    const boxes = placeLabels(nodes, OPTIONS);
    const high = boxes.find((box) => box.nodeId === 'entity:high');
    const low = boxes.find((box) => box.nodeId === 'entity:low');
    expect(high?.visible).toBe(true);
    if (low?.visible) {
      expect(rectsOverlap(boxRect(low), boxRect(high as LabelBox))).toBe(false);
    }
  });

  it('marks labels hidden when the canvas runs out of space', () => {
    const nodes = grid(30, 140, 60).map((n, i) => ({ ...n, x: 20 + (i % 6) * 20, y: 20 + Math.floor(i / 6) * 10 }));
    const boxes = placeLabels(nodes, { width: 140, height: 60, maxLabels: 80 });
    expect(boxes).toHaveLength(nodes.length);
    expect(boxes.some((box) => !box.visible)).toBe(true);
  });

  it('respects maxLabels', () => {
    const nodes = grid(49, OPTIONS.width, OPTIONS.height);
    const boxes = placeLabels(nodes, { ...OPTIONS, maxLabels: 5 });
    expect(visible(boxes)).toHaveLength(5);
    const none = placeLabels(nodes, { ...OPTIONS, maxLabels: 0 });
    expect(visible(none)).toHaveLength(0);
  });

  it('labels only included nodes while their neighbours still block space', () => {
    const entity = node({ id: 'entity:alpha', label: 'alpha', x: 200, y: 200, degree: 4 });
    const fact = node({
      id: 'fact:f1',
      label: 'a very long fact statement that would need a wide label here',
      type: 'fact',
      x: 200,
      y: 224,
      factId: 'f1',
    });
    const boxes = placeLabels([entity, fact], {
      ...OPTIONS,
      include: (n) => n.type === 'entity',
    });

    expect(boxes.map((box) => box.nodeId)).toEqual(['entity:alpha']);
    const box = boxes[0];
    expect(box.visible).toBe(true);
    // The fact circle sits exactly where the "below" candidate would go.
    expect(rectsOverlap(boxRect(box), circleRect(fact, 10))).toBe(false);
  });

  it('preserves input order regardless of priority', () => {
    const nodes = grid(12, OPTIONS.width, OPTIONS.height);
    const boxes = placeLabels(nodes, OPTIONS);
    expect(boxes.map((box) => box.nodeId)).toEqual(nodes.map((n) => n.id));
  });

  it('is deterministic', () => {
    const nodes = grid(30, OPTIONS.width, OPTIONS.height);
    expect(placeLabels(nodes, OPTIONS)).toEqual(placeLabels(nodes, OPTIONS));
  });

  it('respects a custom node radius when avoiding circles', () => {
    const radius = 60;
    const nodes = [
      node({ id: 'entity:a', label: 'alpha', x: 200, y: 200, degree: 3 }),
      node({ id: 'entity:b', label: 'beta', x: 200, y: 260, degree: 2 }),
    ];
    const boxes = placeLabels(nodes, { ...OPTIONS, nodeRadius: () => radius });
    for (const box of visible(boxes)) {
      for (const other of nodes) {
        if (other.id === box.nodeId) continue;
        expect(rectsOverlap(boxRect(box), circleRect(other, radius))).toBe(false);
      }
    }
    expect(visible(boxes).length).toBeGreaterThan(0);
  });
});
