/**
 * web-ui/app/graph/page.tsx — Knowledge graph viewer (NEXT2-003)
 *
 * Interactive knowledge graph:
 * - Nodes = entities + temporal facts, edges = mentions + fact relationships
 * - Data from memory_temporal_query via the typed API client
 * - Search box filters nodes, type filter narrows entity/fact
 * - Click a node to highlight its neighborhood; Expand loads more neighbors
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, type TemporalFact } from '@/lib/api-client';

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

const NODE_COLORS: Record<NodeType, string> = {
  entity: '#4A90D9',
  fact: '#50C878',
};

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
  const CHARGE = -9000;
  const LINK_DIST = 110;
  for (let iter = 0; iter < 160; iter++) {
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

export default function GraphPage() {
  const [facts, setFacts] = useState<TemporalFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'' | NodeType>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Knowledge Graph</h1>
        <button
          onClick={() => { setSelectedId(null); void loadGraph(); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Reload
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      <div className="mb-4 flex gap-3 flex-wrap">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search nodes..."
          className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as '' | NodeType)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All types</option>
          <option value="entity">Entity</option>
          <option value="fact">Fact</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : nodes.length === 0 ? (
        <p className="text-gray-500">No graph data yet. Add temporal facts via memory tools first.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-lg border overflow-hidden">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label="Knowledge graph">
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
                    stroke="#94a3b8"
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
                    fill={NODE_COLORS[n.type]}
                    stroke={n.id === selectedId ? '#1e293b' : '#ffffff'}
                    strokeWidth={n.id === selectedId ? 3 : 1.5}
                  />
                  <text x={n.x} y={n.y + NODE_RADIUS[n.type] + 13} textAnchor="middle" fontSize={11} fill="#475569">
                    {escapeXml(n.label.length > 28 ? `${n.label.slice(0, 28)}…` : n.label)}
                  </text>
                </g>
              ))}
            </svg>
            <div className="flex items-center gap-4 px-4 py-2 border-t text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: NODE_COLORS.entity }} /> Entity
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: NODE_COLORS.fact }} /> Fact
              </span>
              <span className="ml-auto">{visible.length} nodes / {visibleEdges.length} edges</span>
            </div>
          </div>

          <div className="bg-white rounded-lg border p-4 h-fit">
            {selectedNode ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: `${NODE_COLORS[selectedNode.type]}1a`, color: NODE_COLORS[selectedNode.type] }}
                  >
                    {selectedNode.type}
                  </span>
                  <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <h2 className="font-semibold">{selectedNode.label}</h2>
                {selectedNode.fact && (
                  <div className="text-sm text-gray-600 space-y-1">
                    <p><span className="text-gray-400">Category:</span> {selectedNode.fact.category}</p>
                    <p><span className="text-gray-400">Confidence:</span> {selectedNode.fact.confidence}</p>
                    <p><span className="text-gray-400">Valid:</span> {selectedNode.fact.valid ? 'yes' : 'no'}</p>
                    {(selectedNode.fact.entities ?? []).length > 0 && (
                      <div className="flex gap-1 flex-wrap pt-1">
                        {selectedNode.fact.entities.map((e) => (
                          <span key={e} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{e}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  {(adjacency.get(selectedNode.id)?.size ?? 0)} neighbor(s)
                </p>
                <button
                  onClick={() => void expandSelected()}
                  disabled={expanding}
                  className="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                  {expanding ? 'Expanding…' : 'Expand neighbors'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Click a node to see details and expand its neighborhood.</p>
            )}
          </div>
        </div>
      )}

      {!loading && facts.length > 0 && (
        <p className="mt-4 text-sm text-gray-500">Showing {visible.length} of {nodes.length} nodes from {facts.length} facts</p>
      )}
    </div>
  );
}
