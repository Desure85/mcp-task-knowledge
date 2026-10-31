/**
 * Deterministic force-directed layout for the knowledge-graph SVG.
 *
 * Pure maths, no DOM. Repulsion runs through a uniform spatial grid so a
 * 300-node graph stays inside a single animation frame budget. No `Math.random`
 * and no clock reads: the same input yields bit-identical positions.
 */

import type { GraphData } from './graph-model';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  padding?: number;
  iterations?: number;
  seed?: number;
}

export interface LayoutResult {
  positions: Map<string, LayoutPoint>;
  iterations: number;
  energy: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_PADDING = 24;
const DEFAULT_ITERATIONS = 300;
const MAX_ITERATIONS = 600;
const DEFAULT_SEED = 42;
const REPULSION_CUTOFF_CELLS = 3;
const SPRING_STRENGTH = 0.05;
const CENTRE_STRENGTH = 0.01;
const CONVERGED_DISPLACEMENT = 0.5;
const MIN_TEMPERATURE = 0.5;
const JITTER = 0.9;
const EPSILON = 1e-6;

/** mulberry32: small, fast, fully deterministic PRNG in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimNode {
  id: string;
  x: number;
  y: number;
}

interface SimEdge {
  from: number;
  to: number;
  weight: number;
  target: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return value < min ? min : value > max ? max : value;
}

/** Golden-angle spiral start positions; the seeded jitter is skipped for one node. */
function seedPositions(ids: string[], width: number, height: number, seed: number): SimNode[] {
  const n = ids.length;
  const cx = width / 2;
  const cy = height / 2;
  const spread = Math.min(width, height) * 0.38;
  const rng = n > 1 ? createRng(seed) : null;

  return ids.map((id, i) => {
    const angle = i * GOLDEN_ANGLE;
    const radius = Math.sqrt(i / n) * spread;
    const jitterX = rng ? (rng() - 0.5) * JITTER : 0;
    const jitterY = rng ? (rng() - 0.5) * JITTER : 0;
    return {
      id,
      x: cx + Math.cos(angle) * radius + jitterX,
      y: cy + Math.sin(angle) * radius + jitterY,
    };
  });
}

function repulsion(nodes: SimNode[], k: number, fx: Float64Array, fy: Float64Array): void {
  const cell = Math.max(2 * k, EPSILON);
  const buckets = new Map<number, number[]>();
  const nx = Math.max(1, Math.ceil(cell * 1e6));
  const keyOf = (gx: number, gy: number): number => gy * nx + gx;

  for (let i = 0; i < nodes.length; i += 1) {
    const gx = Math.floor(nodes[i].x / cell);
    const gy = Math.floor(nodes[i].y / cell);
    const key = keyOf(gx, gy);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }

  const cutoff = (REPULSION_CUTOFF_CELLS * k) ** 2;
  const minDistance = k * 0.1;

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const gx = Math.floor(a.x / cell);
    const gy = Math.floor(a.y / cell);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = buckets.get(keyOf(gx + ox, gy + oy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > cutoff) continue;
          if (d2 < EPSILON) {
            dx = ((i + 1) % 7) + 0.5;
            dy = ((j + 1) % 5) + 0.5;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const force = (k * k) / Math.max(d, minDistance);
          const ux = (dx / d) * force;
          const uy = (dy / d) * force;
          fx[i] += ux;
          fy[i] += uy;
          fx[j] -= ux;
          fy[j] -= uy;
        }
      }
    }
  }
}

/**
 * Lay out `data.nodes` with a deterministic force-directed simulation.
 * Returns positions for every node id, iterations actually run and the final
 * mean squared displacement (`0` when the simulation converged early).
 */
export function layoutGraph(data: GraphData, options: LayoutOptions): LayoutResult {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const padding = Math.min(options.padding ?? DEFAULT_PADDING, Math.min(width, height) / 2 - 1);
  const pad = Math.max(0, padding);
  const n = data.nodes.length;

  if (n === 0) return { positions: new Map(), iterations: 0, energy: 0 };

  const innerWidth = Math.max(1, width - 2 * pad);
  const innerHeight = Math.max(1, height - 2 * pad);
  const minX = pad;
  const maxX = Math.max(pad, width - pad);
  const minY = pad;
  const maxY = Math.max(pad, height - pad);
  const cx = minX + innerWidth / 2;
  const cy = minY + innerHeight / 2;
  const k = Math.sqrt((innerWidth * innerHeight) / n);

  let iterations = Math.max(0, Math.min(Math.floor(options.iterations ?? DEFAULT_ITERATIONS), MAX_ITERATIONS));
  if (n > 300) {
    iterations = Math.min(iterations, Math.max(80, Math.round(300 * Math.sqrt(300 / n))));
  }

  const ids = data.nodes.map((node) => node.id).sort((a, b) => a.localeCompare(b));
  const nodes = seedPositions(ids, width, height, options.seed ?? DEFAULT_SEED);
  for (const node of nodes) {
    node.x = clamp(node.x, minX, maxX);
    node.y = clamp(node.y, minY, maxY);
  }

  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));

  const edges: SimEdge[] = [];
  for (const edge of data.edges) {
    const from = index.get(edge.source);
    const to = index.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
    const target = edge.kind === 'co-occurs' ? k / Math.sqrt(weight) : k;
    edges.push({ from, to, weight, target });
  }

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const maxTemperature = Math.min(width, height) / 10;
  let iterationsRun = 0;
  let energy = 0;

  for (let iter = 0; iter < iterations; iter += 1) {
    fx.fill(0);
    fy.fill(0);

    repulsion(nodes, k, fx, fy);

    for (const edge of edges) {
      const a = nodes[edge.from];
      const b = nodes[edge.to];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || EPSILON;
      const pull = (d - edge.target) * SPRING_STRENGTH;
      const ux = (dx / d) * pull;
      const uy = (dy / d) * pull;
      fx[edge.from] += ux;
      fy[edge.from] += uy;
      fx[edge.to] -= ux;
      fy[edge.to] -= uy;
    }

    for (let i = 0; i < n; i += 1) {
      fx[i] += (cx - nodes[i].x) * CENTRE_STRENGTH;
      fy[i] += (cy - nodes[i].y) * CENTRE_STRENGTH;
    }

    const progress = iterations <= 1 ? 1 : iter / (iterations - 1);
    const temperature = Math.max(MIN_TEMPERATURE, maxTemperature * (1 - progress) + MIN_TEMPERATURE * progress);

    let maxDisplacement = 0;
    let squaredSum = 0;
    for (let i = 0; i < n; i += 1) {
      const len = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]);
      const scale = len > temperature && len > 0 ? temperature / len : 1;
      const dx = Number.isFinite(fx[i]) ? fx[i] * scale : 0;
      const dy = Number.isFinite(fy[i]) ? fy[i] * scale : 0;
      nodes[i].x = clamp(nodes[i].x + dx, minX, maxX);
      nodes[i].y = clamp(nodes[i].y + dy, minY, maxY);
      const moved = Math.sqrt(dx * dx + dy * dy);
      if (moved > maxDisplacement) maxDisplacement = moved;
      squaredSum += dx * dx + dy * dy;
    }

    iterationsRun = iter + 1;
    energy = squaredSum / n;

    if (maxDisplacement < CONVERGED_DISPLACEMENT) {
      energy = 0;
      break;
    }
  }

  const positions = new Map<string, LayoutPoint>();
  for (const node of nodes) {
    positions.set(node.id, {
      x: clamp(node.x, minX, maxX),
      y: clamp(node.y, minY, maxY),
    });
  }

  return { positions, iterations: iterationsRun, energy };
}
