/**
 * graph-viz.spec.ts — Tests for knowledge graph visualization (NEXT-014).
 */

import { describe, it, expect } from 'vitest';
import {
  generateGraphHTML,
  buildGraphFromFacts,
  graphStats,
  type GraphData,
  type GraphNode,
  type GraphEdge,
} from '../src/memory/graph-viz.js';

const sampleGraph: GraphData = {
  nodes: [
    { id: '1', label: 'Alice', type: 'entity', tags: ['person'] },
    { id: '2', label: 'Bob', type: 'entity', tags: ['person'] },
    { id: '3', label: 'Works at TechCorp', type: 'fact', tags: ['employment'] },
    { id: '4', label: 'Alice Profile', type: 'profile' },
    { id: '5', label: 'Deploy Event', type: 'event' },
    { id: '6', label: 'TypeScript', type: 'concept', tags: ['language'] },
  ],
  edges: [
    { source: '1', target: '3', label: 'states' },
    { source: '2', target: '3', label: 'states' },
    { source: '1', target: '4', label: 'has_profile' },
    { source: '3', target: '5', label: 'led_to' },
    { source: '1', target: '6', label: 'prefers' },
  ],
};

describe('generateGraphHTML', () => {
  it('generates valid HTML with DOCTYPE', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes title in HTML', () => {
    const html = generateGraphHTML(sampleGraph, { title: 'My Graph' });
    expect(html).toContain('<title>My Graph</title>');
    expect(html).toContain('<h1>My Graph</h1>');
  });

  it('includes node data as JSON', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('"label":"Alice"');
    expect(html).toContain('"label":"Bob"');
  });

  it('includes edge data as JSON', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('"source":"1"');
    expect(html).toContain('"target":"3"');
  });

  it('includes SVG element', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('<svg id="graph">');
  });

  it('includes search input', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('id="search"');
  });

  it('includes filter dropdown', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('id="filter"');
    expect(html).toContain('option value="entity"');
    expect(html).toContain('option value="fact"');
  });

  it('includes legend with type colors', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('id="legend"');
    expect(html).toContain('#4A90D9');
    expect(html).toContain('#50C878');
  });

  it('uses custom dimensions', () => {
    const html = generateGraphHTML(sampleGraph, { width: 1200, height: 800 });
    expect(html).toContain('1200');
    expect(html).toContain('800');
  });

  it('escapes HTML in title', () => {
    const html = generateGraphHTML(sampleGraph, { title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles empty graph', () => {
    const html = generateGraphHTML({ nodes: [], edges: [] });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('NODES = []');
  });

  it('includes tooltip div', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('id="tooltip"');
  });

  it('includes force simulation script', () => {
    const html = generateGraphHTML(sampleGraph);
    expect(html).toContain('function tick()');
    expect(html).toContain('requestAnimationFrame');
  });
});

describe('buildGraphFromFacts', () => {
  it('builds graph from fact array', () => {
    const facts = [
      { id: '1', title: 'Fact A', content: 'Content A', tags: ['test'] },
      { id: '2', title: 'Fact B', content: 'Content B', tags: ['test'] },
    ];
    const graph = buildGraphFromFacts(facts);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].label).toBe('Fact A');
    expect(graph.nodes[0].type).toBe('fact');
    expect(graph.edges).toHaveLength(0);
  });

  it('includes relationships as edges', () => {
    const facts = [
      { id: '1', title: 'A', content: 'a' },
      { id: '2', title: 'B', content: 'b' },
    ];
    const rels = [{ source: '1', target: '2', label: 'relates_to' }];
    const graph = buildGraphFromFacts(facts, rels);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].label).toBe('relates_to');
  });

  it('handles empty facts', () => {
    const graph = buildGraphFromFacts([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('preserves tags', () => {
    const facts = [{ id: '1', title: 'T', content: 'c', tags: ['tag1', 'tag2'] }];
    const graph = buildGraphFromFacts(facts);
    expect(graph.nodes[0].tags).toEqual(['tag1', 'tag2']);
  });
});

describe('graphStats', () => {
  it('counts nodes and edges', () => {
    const stats = graphStats(sampleGraph);
    expect(stats.nodes).toBe(6);
    expect(stats.edges).toBe(5);
  });

  it('counts by type', () => {
    const stats = graphStats(sampleGraph);
    expect(stats.byType.entity).toBe(2);
    expect(stats.byType.fact).toBe(1);
    expect(stats.byType.profile).toBe(1);
    expect(stats.byType.event).toBe(1);
    expect(stats.byType.concept).toBe(1);
  });

  it('computes density', () => {
    const stats = graphStats(sampleGraph);
    expect(stats.density).toBeGreaterThan(0);
    expect(stats.density).toBeLessThanOrEqual(1);
  });

  it('computes avg degree', () => {
    const stats = graphStats(sampleGraph);
    expect(stats.avgDegree).toBeGreaterThan(0);
  });

  it('handles empty graph', () => {
    const stats = graphStats({ nodes: [], edges: [] });
    expect(stats.nodes).toBe(0);
    expect(stats.edges).toBe(0);
    expect(stats.density).toBe(0);
    expect(stats.avgDegree).toBe(0);
  });

  it('handles single node', () => {
    const stats = graphStats({ nodes: [{ id: '1', label: 'solo', type: 'entity' }], edges: [] });
    expect(stats.nodes).toBe(1);
    expect(stats.edges).toBe(0);
    expect(stats.density).toBe(0);
    expect(stats.avgDegree).toBe(0);
  });

  it('handles complete graph', () => {
    const nodes: GraphNode[] = [
      { id: '1', label: 'A', type: 'entity' },
      { id: '2', label: 'B', type: 'entity' },
      { id: '3', label: 'C', type: 'entity' },
    ];
    const edges: GraphEdge[] = [
      { source: '1', target: '2' },
      { source: '1', target: '3' },
      { source: '2', target: '3' },
    ];
    const stats = graphStats({ nodes, edges });
    expect(stats.density).toBe(1);
    expect(stats.avgDegree).toBe(2);
  });
});
