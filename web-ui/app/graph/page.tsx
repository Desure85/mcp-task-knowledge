/**
 * web-ui/app/graph/page.tsx — Knowledge graph viewer (NEXT2-003, UI-24, UI-28).
 *
 * Orchestrates the graph: facts, mode, selection, search, focus, related-fact
 * loading, zoom/pan and the accessible table. Topology and label placement
 * live in the pure lib modules; the SVG/pieces live under components/graph.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type TemporalFact } from '@/lib/api-client';
import { buildGraph, type GraphMode } from '@/lib/graph-model';
import { layoutGraph } from '@/lib/graph-layout';
import {
  observeThemeAttributes,
  readCssVariable,
  readGraphPalette,
  type GraphPalette,
} from '@/lib/graph-theme';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, CardBody, EmptyState, Input, Skeleton } from '@/components/ui';
import { IconGraph } from '@/components/icons';
import {
  GRAPH_CENTRE,
  GRAPH_HEIGHT,
  GRAPH_PADDING,
  GRAPH_WIDTH,
  GraphCanvas,
  MAX_ZOOM,
  MIN_ZOOM,
  type PositionedNode,
} from '@/components/graph/GraphCanvas';
import { Legend } from '@/components/graph/Legend';
import { ModeSwitch } from '@/components/graph/ModeSwitch';
import { NodePanel } from '@/components/graph/NodePanel';
import { NodeTable } from '@/components/graph/NodeTable';

const MODE_STORAGE_KEY = 'graph.mode';
/** Fact labels join the collision set at this zoom, not on every wheel tick. */
const SHOW_FACT_LABELS_ZOOM = 1.15;

function useGraphPalette(): GraphPalette {
  const [palette, setPalette] = useState<GraphPalette>(() => readGraphPalette(() => ''));

  useEffect(() => {
    const refresh = () => setPalette(readGraphPalette(readCssVariable));
    refresh();
    return observeThemeAttributes(document.documentElement, refresh);
  }, []);

  return palette;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export default function GraphPage() {
  const [facts, setFacts] = useState<TemporalFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GraphMode>('entities');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusOnSelection, setFocusOnSelection] = useState(true);
  const [viewport, setViewport] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [expanding, setExpanding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState<Set<string>>(new Set());
  const palette = useGraphPalette();

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.memory.temporalQuery({ limit: 200, includeInvalidated: true });
      setFacts(Array.isArray(data.facts) ? data.facts : []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === 'entities' || stored === 'facts') setMode(stored);
    } catch {
      /* storage blocked — the default mode still works */
    }
  }, []);

  const graph = useMemo(() => buildGraph(facts, mode), [facts, mode]);

  const layout = useMemo(
    () => layoutGraph(graph, { width: GRAPH_WIDTH, height: GRAPH_HEIGHT, padding: GRAPH_PADDING }),
    [graph],
  );

  const positionedNodes = useMemo<PositionedNode[]>(
    () =>
      graph.nodes.map((node) => {
        const point = layout.positions.get(node.id);
        return {
          ...node,
          x: point?.x ?? GRAPH_WIDTH / 2,
          y: point?.y ?? GRAPH_HEIGHT / 2,
        };
      }),
    [graph, layout],
  );

  const selectedNode = useMemo(
    () => (selectedId ? (graph.nodes.find((node) => node.id === selectedId) ?? null) : null),
    [graph.nodes, selectedId],
  );

  const selectedFact = useMemo(
    () =>
      selectedNode?.type === 'fact' && selectedNode.factId
        ? (facts.find((fact) => fact.id === selectedNode.factId) ?? null)
        : null,
    [facts, selectedNode],
  );

  const relatedEntity = selectedNode
    ? selectedNode.type === 'entity'
      ? (selectedNode.entity ?? selectedNode.label)
      : (selectedFact?.entities[0] ?? null)
    : null;

  const relatedDisabledReason = !relatedEntity
    ? 'Select a node that mentions an entity to load more facts.'
    : exhausted.has(relatedEntity)
      ? `All facts for «${relatedEntity}» are loaded.`
      : null;

  const showFactLabels = viewport.zoom >= SHOW_FACT_LABELS_ZOOM;

  const matchIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return null;
    return new Set(
      graph.nodes
        .filter((node) => node.label.toLowerCase().includes(query))
        .map((node) => node.id),
    );
  }, [graph.nodes, searchQuery]);

  const focusIds = useMemo(() => {
    if (!focusOnSelection || !selectedId || !graph.nodes.some((node) => node.id === selectedId)) {
      return null;
    }
    const ids = new Set<string>([selectedId]);
    for (const edge of graph.edges) {
      if (edge.source === selectedId) ids.add(edge.target);
      else if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [focusOnSelection, selectedId, graph]);

  const tableNodes = useMemo(
    () => (matchIds ? graph.nodes.filter((node) => matchIds.has(node.id)) : graph.nodes),
    [graph.nodes, matchIds],
  );

  const zoomAt = useCallback((nextZoom: number, pivot: { x: number; y: number }) => {
    setViewport((current) => {
      const zoom = clampZoom(nextZoom);
      const ratio = zoom / current.zoom;
      return {
        zoom,
        pan: {
          x: pivot.x - (pivot.x - current.pan.x) * ratio,
          y: pivot.y - (pivot.y - current.pan.y) * ratio,
        },
      };
    });
  }, []);

  const panBy = useCallback((delta: { x: number; y: number }) => {
    setViewport((current) => ({
      ...current,
      pan: { x: current.pan.x + delta.x, y: current.pan.y + delta.y },
    }));
  }, []);

  const resetViewport = useCallback(() => {
    setViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  }, []);

  const selectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    setStatus(null);
  }, []);

  const chooseMode = useCallback((next: GraphMode) => {
    setMode(next);
    setStatus(null);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* storage blocked — the in-memory mode still works */
    }
  }, []);

  const selectFact = useCallback(
    (factId: string) => {
      chooseMode('facts');
      setSelectedId(`fact:${factId}`);
      setStatus(null);
    },
    [chooseMode],
  );

  useEffect(() => {
    if (selectedId && !graph.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [graph.nodes, selectedId]);

  const loadRelated = useCallback(async () => {
    if (!relatedEntity) return;
    setStatus(null);
    setExpanding(true);
    try {
      const data = await api.memory.temporalQuery({ entity: relatedEntity, limit: 100 });
      const known = new Set(facts.map((fact) => fact.id));
      const fresh = (data.facts ?? []).filter((fact) => !known.has(fact.id));
      if (fresh.length > 0) {
        setFacts((previous) => [...previous, ...fresh]);
        setStatus(`Loaded ${fresh.length} more facts`);
      } else {
        setStatus(`No more facts for «${relatedEntity}»`);
        setExhausted((previous) => {
          const next = new Set(previous);
          next.add(relatedEntity);
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExpanding(false);
    }
  }, [facts, relatedEntity]);

  function reload() {
    setSelectedId(null);
    setStatus(null);
    setExhausted(new Set());
    resetViewport();
    void loadGraph();
  }

  return (
    <div>
      <PageHeader
        title="Knowledge graph"
        description="Entities and temporal facts, linked by mentions and relationships."
        actions={
          <Button variant="primary" onClick={reload} loading={loading}>
            Reload
          </Button>
        }
      />

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger"
        >
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ModeSwitch mode={mode} onChange={chooseMode} />
          <label className="flex items-center gap-2 text-[12px] text-ink">
            <input
              type="checkbox"
              checked={focusOnSelection}
              onChange={(event) => setFocusOnSelection(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            />
            Focus on selection
          </label>
        </div>
        <Input
          label="Search nodes"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Entity or fact text"
        />
      </div>

      {loading ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardBody>
              <Skeleton className="h-[360px] w-full" />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </CardBody>
          </Card>
        </div>
      ) : graph.nodes.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No graph data yet"
            hint="Add temporal facts via memory tools first, then reload."
            icon={IconGraph}
            action={
              <Button size="sm" variant="primary" onClick={reload}>
                Reload
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="min-w-0 overflow-hidden bg-canvas lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Zoom out"
                  onClick={() => zoomAt(viewport.zoom / 1.25, GRAPH_CENTRE)}
                >
                  −
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Zoom in"
                  onClick={() => zoomAt(viewport.zoom * 1.25, GRAPH_CENTRE)}
                >
                  +
                </Button>
                <Button size="sm" variant="ghost" aria-label="Reset zoom" onClick={resetViewport}>
                  Reset
                </Button>
              </div>
              <span className="text-[11px] text-muted">Zoom {Math.round(viewport.zoom * 100)}%</span>
            </div>

            <GraphCanvas
              nodes={positionedNodes}
              edges={graph.edges}
              mode={mode}
              palette={palette}
              selectedId={selectedId}
              focusIds={focusIds}
              matchIds={matchIds}
              showFactLabels={showFactLabels}
              zoom={viewport.zoom}
              pan={viewport.pan}
              onSelect={selectNode}
              onZoomAt={zoomAt}
              onPan={panBy}
              onReset={resetViewport}
            />

            <Legend mode={mode} palette={palette} />
          </Card>

          <Card className="h-fit min-w-0">
            <CardBody>
              <NodePanel
                node={selectedNode}
                facts={facts}
                relatedEntity={relatedEntity}
                relatedLoading={expanding}
                relatedDisabled={expanding || !relatedEntity || (relatedEntity ? exhausted.has(relatedEntity) : false)}
                relatedDisabledReason={relatedDisabledReason}
                status={status}
                onLoadRelated={() => void loadRelated()}
                onSelectNode={selectNode}
                onSelectFact={selectFact}
                onClear={() => selectNode(null)}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {!loading && graph.nodes.length > 0 && (
        <p className="mt-4 text-[12px] text-muted">
          Showing {graph.nodes.length} nodes and {graph.edges.length} edges from {facts.length} facts
        </p>
      )}

      {!loading && graph.nodes.length > 0 && (
        <div className="mt-4">
          <NodeTable
            nodes={tableNodes}
            facts={facts}
            selectedId={selectedId}
            onSelect={selectNode}
          />
        </div>
      )}
    </div>
  );
}
