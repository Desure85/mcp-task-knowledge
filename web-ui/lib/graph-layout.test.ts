/**
 * Determinism, bounds and performance tests for the force-directed layout.
 */

import { describe, it, expect } from 'vitest';
import type { GraphData } from './graph-model';
import { createRng, layoutGraph, type LayoutOptions } from './graph-layout';

const WIDTH = 960;
const HEIGHT = 560;
const PADDING = 24;

function synthetic(nodes: number, edges: number): GraphData {
  const graphNodes = Array.from({ length: nodes }, (_, i) => {
    const name = `e${String(i).padStart(3, '0')}`;
    return {
      id: `entity:${name}`,
      label: name,
      type: 'entity' as const,
      entity: name,
      factCount: 1,
      degree: 0,
    };
  });

  const graphEdges = Array.from({ length: edges }, (_, k) => {
    const from = k % nodes;
    let to = (k * 7 + 3) % nodes;
    if (to === from) to = (to + 1) % nodes;
    return {
      id: `co-occurs:${from}>${to}`,
      source: `entity:e${String(from).padStart(3, '0')}`,
      target: `entity:e${String(to).padStart(3, '0')}`,
      kind: 'co-occurs' as const,
      weight: 1 + (k % 3),
    };
  });

  return { mode: 'entities', nodes: graphNodes, edges: graphEdges };
}

function options(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return { width: WIDTH, height: HEIGHT, padding: PADDING, iterations: 300, seed: 42, ...over };
}

function assertInBounds(data: GraphData, result: ReturnType<typeof layoutGraph>): void {
  expect(result.positions.size).toBe(data.nodes.length);
  for (const node of data.nodes) {
    const point = result.positions.get(node.id);
    expect(point).toBeDefined();
    expect(Number.isFinite(point?.x)).toBe(true);
    expect(Number.isFinite(point?.y)).toBe(true);
    expect(point?.x).toBeGreaterThanOrEqual(PADDING - 1e-9);
    expect(point?.y).toBeGreaterThanOrEqual(PADDING - 1e-9);
    expect(point?.x).toBeLessThanOrEqual(WIDTH - PADDING + 1e-9);
    expect(point?.y).toBeLessThanOrEqual(HEIGHT - PADDING + 1e-9);
  }
}

describe('graph-layout: createRng', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const first = Array.from({ length: 50 }, () => a());
    const second = Array.from({ length: 50 }, () => b());
    expect(first).toEqual(second);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(first).size).toBeGreaterThan(40);
  });

  it('differs across seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });
});

describe('graph-layout: degenerate input', () => {
  it('handles an empty graph', () => {
    const result = layoutGraph({ mode: 'entities', nodes: [], edges: [] }, options());
    expect(result.positions.size).toBe(0);
    expect(result.iterations).toBe(0);
    expect(result.energy).toBe(0);
  });

  it('places a single node inside the canvas', () => {
    const data = synthetic(1, 0);
    const result = layoutGraph(data, options());
    assertInBounds(data, result);
  });

  it('keeps isolated nodes in bounds', () => {
    const data: GraphData = {
      mode: 'entities',
      nodes: [
        { id: 'entity:lonely', label: 'lonely', type: 'entity', entity: 'lonely', factCount: 0, degree: 0 },
        { id: 'entity:a', label: 'a', type: 'entity', entity: 'a', factCount: 1, degree: 1 },
        { id: 'entity:b', label: 'b', type: 'entity', entity: 'b', factCount: 1, degree: 1 },
      ],
      edges: [
        { id: 'co-occurs:entity:a>entity:b', source: 'entity:a', target: 'entity:b', kind: 'co-occurs', weight: 3 },
      ],
    };
    const result = layoutGraph(data, options());
    assertInBounds(data, result);
  });

  it('survives multi-edges and unknown edge endpoints', () => {
    const data = synthetic(4, 6);
    data.edges.push({
      id: 'ghost',
      source: 'entity:e000',
      target: 'entity:missing',
      kind: 'mentions',
      weight: 1,
    });
    data.edges.push({ ...data.edges[0], id: 'duplicate' });
    const result = layoutGraph(data, options());
    assertInBounds(data, result);
  });

  it('respects zero iterations', () => {
    const data = synthetic(5, 4);
    const result = layoutGraph(data, options({ iterations: 0 }));
    expect(result.iterations).toBe(0);
    expect(result.energy).toBe(0);
    assertInBounds(data, result);
  });
});

describe('graph-layout: determinism', () => {
  it('produces identical positions on repeated runs', () => {
    const data = synthetic(40, 70);
    const a = layoutGraph(data, options());
    const b = layoutGraph(data, options());
    expect(Array.from(a.positions.entries())).toEqual(Array.from(b.positions.entries()));
    expect(a.iterations).toBe(b.iterations);
    expect(a.energy).toBe(b.energy);
  });

  it('does not depend on node array order', () => {
    const data = synthetic(20, 30);
    const shuffled: GraphData = { ...data, nodes: [...data.nodes].reverse() };
    const a = layoutGraph(data, options());
    const b = layoutGraph(shuffled, options());
    for (const node of data.nodes) {
      expect(b.positions.get(node.id)).toEqual(a.positions.get(node.id));
    }
  });
});

describe('graph-layout: medium graph (76 nodes)', () => {
  it('converges or runs the configured iterations, inside bounds', () => {
    const data = synthetic(76, 120);
    const started = performance.now();
    const result = layoutGraph(data, options());
    const elapsed = performance.now() - started;

    console.log(`layout 76 nodes / 120 edges: ${elapsed.toFixed(1)} ms, iterations=${result.iterations}`);
    assertInBounds(data, result);
    expect(result.iterations).toBeLessThanOrEqual(300);
    expect(result.iterations === 300 || result.energy === 0).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('graph-layout: large graph (300 nodes)', () => {
  it('finishes under 300 ms with finite, in-bounds coordinates', () => {
    const data = synthetic(300, 450);
    const started = performance.now();
    const result = layoutGraph(data, options());
    const elapsed = performance.now() - started;

    console.log(`layout 300 nodes / 450 edges: ${elapsed.toFixed(1)} ms, iterations=${result.iterations}`);
    assertInBounds(data, result);
    expect(result.iterations).toBeLessThanOrEqual(300);
    expect(elapsed).toBeLessThan(300);
  });

  it('scales iterations down beyond 300 nodes', () => {
    const data = synthetic(400, 600);
    const result = layoutGraph(data, options({ iterations: 600 }));
    expect(result.iterations).toBeLessThanOrEqual(260);
    assertInBounds(data, result);
  });
});
