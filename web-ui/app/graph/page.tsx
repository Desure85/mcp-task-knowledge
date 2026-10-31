/**
 * web-ui/app/graph/page.tsx — Knowledge graph viewer (NEXT2-003, UI-24)
 *
 * Interactive knowledge graph:
 * - Nodes = entities + temporal facts, edges = mentions + fact relationships
 * - Data from memory_temporal_query via the typed API client
 * - Search box filters nodes, type filter narrows entity/fact
 * - Click a node to highlight its neighborhood; Expand loads more neighbors
 *
 * SVG colours are semantic tokens resolved at runtime; the palette is
 * re-read when ThemeManager changes data-theme/data-mode on <html>.
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, type TemporalFact } from '@/lib/api-client';
import {
  observeThemeAttributes,
  readCssVariable,
  readGraphPalette,
  type GraphPalette,
} from '@/lib/graph-theme';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardBody, EmptyState, Input, Select, Skeleton } from '@/components/ui';
import { IconGraph } from '@/components/icons';

type NodeType = 'entity' | 'fact';

interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  x: number;
  y: number;
  fact?: TemporalFact;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

const NODE_RADIUS: Record<NodeType, number> = {
  entity: 14,
  fact: 10,
};

const WIDTH = 960;
const HEIGHT = 560;

function buildGraph(facts: TemporalFact[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const link = (source: string, target: string, label: string) => {
    const key = `${source}>${target}:${label}`;
    if (source !== target && nodes.has(source) && nodes.has(target) && !edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ source, target, label });
    }
  };

  for (const f of facts) {
    const factId = `fact:${f.id}`;
    nodes.set(factId, {
      id: factId,
      label: f.statement.length > 42 ? `${f.statement.slice(0, 42)}…` : f.statement,
      type: 'fact',
      x: 0,
      y: 0,
      fact: f,
    });
    for (const e of f.entities ?? []) {
      const entityId = `entity:${e}`;
      if (!nodes.has(entityId)) {
        nodes.set(entityId, { id: entityId, label: e, type: 'entity', x: 0, y: 0 });
      }
      link(factId, entityId, 'mentions');
    }
  }

  const factIds = new Set(facts.map((f) => `fact:${f.id}`));
  for (const f of facts) {
    for (const r of f.relationships ?? []) {
      const targetId = `fact:${r.targetId}`;
      if (factIds.has(targetId)) link(`fact:${f.id}`, targetId, r.type);
    }
    if (f.supersededBy && factIds.has(`fact:${f.supersededBy}`)) {
      link(`fact:${f.id}`, `fact:${f.supersededBy}`, 'supersededBy');
    }
  }

  const nodeArr = Array.from(nodes.values());
  layout(nodeArr, edges);
  return { nodes: nodeArr, edges };
}

function layout(nodes: GraphNode[], edges: GraphEdge[]): void {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, nodes.length);
    n.x = WIDTH / 2 + Math.cos(a) * (WIDTH / 3);
    n.y = HEIGHT / 2 + Math.sin(a) * (HEIGHT / 3);
  });
  const CHARGE = -40000;
  const LINK_DIST = 78;
  for (let iter = 0; iter < 220; iter++) {
    for (const n of nodes) {
      let fx = 0;
      let fy = 0;
      for (const m of nodes) {
        if (n === m) continue;
        const dx = n.x - m.x;
        const dy = n.y - m.y;
        const d = Math.max(12, Math.sqrt(dx * dx + dy * dy));
        const f = CHARGE / (d * d);
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      for (const id of adj.get(n.id) ?? []) {
        const m = byId.get(id);
        if (!m) continue;
        const dx = m.x - n.x;
        const dy = m.y - n.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = (d - LINK_DIST) * 0.02;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      n.x += fx;
      n.y += fy;
      n.x = Math.max(20, Math.min(WIDTH - 20, n.x));
      n.y = Math.max(20, Math.min(HEIGHT - 20, n.y));
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function useGraphPalette(): GraphPalette {
  const [palette, setPalette] = useState<GraphPalette>(() => readGraphPalette(() => ''));

  useEffect(() => {
    const refresh = () => setPalette(readGraphPalette(readCssVariable));
    refresh();
    return observeThemeAttributes(document.documentElement, refresh);
  }, []);

  return palette;
}

export default function GraphPage() {
  const [facts, setFacts] = useState<TemporalFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'' | NodeType>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const palette = useGraphPalette();

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.memory.temporalQuery({ limit: 200 });
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const { nodes, edges } = useMemo(() => buildGraph(facts), [facts]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const e of edges) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }
    return adj;
  }, [nodes, edges]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return nodes.filter((n) => {
      if (filterType && n.type !== filterType) return false;
      if (q && !n.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nodes, searchQuery, filterType]);

  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds],
  );

  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const id of adjacency.get(selectedId) ?? []) set.add(id);
    return set;
  }, [selectedId, adjacency]);

  const selectedNode = selectedId ? (nodes.find((n) => n.id === selectedId) ?? null) : null;

  async function expandSelected() {
    if (!selectedNode) return;
    const entity = selectedNode.type === 'entity'
      ? selectedNode.label
      : (selectedNode.fact?.entities ?? [])[0];
    if (!entity) return;
    try {
      setExpanding(true);
      const data = await api.memory.temporalQuery({ entity, limit: 100 });
      const known = new Set(facts.map((f) => f.id));
      const fresh = (data.facts ?? []).filter((f) => !known.has(f.id));
      if (fresh.length > 0) setFacts((prev) => [...prev, ...fresh]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExpanding(false);
    }
  }

  function nodeOpacity(id: string): number {
    if (!neighborhood) return 1;
    return neighborhood.has(id) ? 1 : 0.15;
  }

  return (
    <div>
      <PageHeader
        title="Knowledge graph"
        description="Entities and temporal facts, linked by mentions and relationships."
        actions={
          <Button
            variant="primary"
            onClick={() => { setSelectedId(null); void loadGraph(); }}
            loading={loading}
          >
            Reload
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Input
          label="Search nodes"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Label or entity"
        />
        <Select
          label="Node type"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as '' | NodeType)}
        >
          <option value="">All types</option>
          <option value="entity">Entity</option>
          <option value="fact">Fact</option>
        </Select>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2"><CardBody><Skeleton className="h-[360px] w-full" /></CardBody></Card>
          <Card><CardBody><Skeleton className="h-3 w-2/3" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-2 h-3 w-4/5" /></CardBody></Card>
        </div>
      ) : nodes.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No graph data yet"
            hint="Add temporal facts via memory tools first, then reload."
            icon={IconGraph}
            action={<Button size="sm" variant="primary" onClick={() => void loadGraph()}>Reload</Button>}
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden bg-canvas lg:col-span-2">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" role="img" aria-label="Knowledge graph">
              {visibleEdges.map((e) => {
                const s = nodes.find((n) => n.id === e.source);
                const t = nodes.find((n) => n.id === e.target);
                if (!s || !t) return null;
                const dim = neighborhood && (!neighborhood.has(e.source) || !neighborhood.has(e.target));
                return (
                  <line
                    key={`${e.source}>${e.target}:${e.label}`}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={palette.edge}
                    strokeWidth={1.5}
                    opacity={dim ? 0.1 : 0.8}
                  />
                );
              })}
              {visible.map((n) => (
                <g
                  key={n.id}
                  opacity={nodeOpacity(n.id)}
                  onClick={() => setSelectedId(n.id === selectedId ? null : n.id)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={NODE_RADIUS[n.type]}
                    fill={palette.nodes[n.type]}
                    stroke={n.id === selectedId ? palette.selectedStroke : palette.nodeStroke}
                    strokeWidth={n.id === selectedId ? 3 : 1.5}
                  />
                  {(n.type === 'entity' || n.id === selectedId) && (
                    <text x={n.x} y={n.y + NODE_RADIUS[n.type] + 13} textAnchor="middle" fontSize={11} fill={palette.label}>
                      {escapeXml(n.label.length > 28 ? `${n.label.slice(0, 28)}…` : n.label)}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: palette.nodes.entity }} aria-hidden="true" /> Entity
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: palette.nodes.fact }} aria-hidden="true" /> Fact
              </span>
              <span className="ml-auto">{visible.length} nodes / {visibleEdges.length} edges</span>
            </div>
          </Card>

          <Card className="h-fit">
            <CardBody>
              {selectedNode ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: palette.nodes[selectedNode.type] }}
                        aria-hidden="true"
                      />
                      {selectedNode.type}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Clear node selection"
                      onClick={() => setSelectedId(null)}
                    >
                      ×
                    </Button>
                  </div>
                  <h2 className="text-[14px] font-semibold text-ink">{selectedNode.label}</h2>
                  {selectedNode.fact && (
                    <div className="space-y-1 text-[12px] text-muted">
                      <p><span className="text-muted">Category:</span> <span className="text-ink">{selectedNode.fact.category}</span></p>
                      <p><span className="text-muted">Confidence:</span> <span className="text-ink">{selectedNode.fact.confidence}</span></p>
                      <p><span className="text-muted">Valid:</span> <span className="text-ink">{selectedNode.fact.valid ? 'yes' : 'no'}</span></p>
                      {(selectedNode.fact.entities ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {selectedNode.fact.entities.map((entity) => (
                            <Badge key={entity}>{entity}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-muted">
                    {adjacency.get(selectedNode.id)?.size ?? 0} neighbor(s)
                  </p>
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => void expandSelected()}
                    loading={expanding}
                  >
                    Expand neighbors
                  </Button>
                </div>
              ) : (
                <p className="text-[12px] text-muted">Click a node to see details and expand its neighborhood.</p>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {!loading && nodes.length > 0 && (
        <p className="mt-4 text-[12px] text-muted">
          Showing {visible.length} of {nodes.length} nodes from {facts.length} facts
        </p>
      )}

      {!loading && visible.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] font-medium text-ink">Node list</summary>
          <Card className="mt-2">
            <CardBody className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <caption className="sr-only">Graph nodes</caption>
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Label</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Type</th>
                    <th scope="col" className="py-1.5 font-medium">Neighbors</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((node) => (
                    <tr key={node.id} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(node.id)}
                          className="text-left text-ink underline-offset-2 hover:text-accent hover:underline"
                        >
                          {node.label}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3"><Badge>{node.type}</Badge></td>
                      <td className="py-1.5 text-muted">{adjacency.get(node.id)?.size ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </details>
      )}
    </div>
  );
}
