/**
 * graph-viz.ts — Interactive knowledge graph visualization (NEXT-014).
 *
 * Generates a self-contained HTML file with an interactive knowledge graph.
 * Nodes = entities/facts, edges = relationships. Supports filter, search,
 * expand, and force-directed layout — zero dependencies, pure SVG + JS.
 */

/// <reference types="node" />


export interface GraphNode {
  id: string;
  label: string;
  type: 'entity' | 'fact' | 'profile' | 'event' | 'concept';
  tags?: string[];
  weight?: number;
  color?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  weight?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VizOptions {
  title?: string;
  width?: number;
  height?: number;
  showLabels?: boolean;
  filterTag?: string;
  nodeRadius?: number;
  charge?: number;
  linkDistance?: number;
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateGraphHTML(data: GraphData, opts?: VizOptions): string {
  const title = opts?.title ?? 'Knowledge Graph';
  const width = opts?.width ?? 960;
  const height = opts?.height ?? 600;
  const showLabels = opts?.showLabels ?? true;
  const nodeRadius = opts?.nodeRadius ?? 12;
  const charge = opts?.charge ?? -300;
  const linkDistance = opts?.linkDistance ?? 80;

  const colors: Record<string, string> = {
    entity: '#4A90D9',
    fact: '#50C878',
    profile: '#FF6B6B',
    event: '#FFB347',
    concept: '#9B59B6',
  };

  const nodesJson = JSON.stringify(
    data.nodes.map((n) => ({ ...n, color: n.color ?? colors[n.type] ?? '#888' })),
  );
  const edgesJson = JSON.stringify(data.edges);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
#toolbar { position: fixed; top: 0; left: 0; right: 0; padding: 12px 20px; background: #16213e; border-bottom: 1px solid #0f3460; z-index: 10; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#toolbar h1 { font-size: 16px; font-weight: 600; color: #e94560; white-space: nowrap; }
#search { flex: 1; min-width: 200px; padding: 6px 12px; background: #0f3460; border: 1px solid #1a1a4e; color: #eee; border-radius: 4px; font-size: 13px; }
#search:focus { outline: none; border-color: #e94560; }
#filter, #cluster, #depth { padding: 6px 12px; background: #0f3460; border: 1px solid #1a1a4e; color: #eee; border-radius: 4px; font-size: 13px; cursor: pointer; }
#stats { font-size: 12px; color: #888; white-space: nowrap; }
#graph { width: 100vw; height: 100vh; }
.node { cursor: pointer; transition: opacity 0.2s; }
.node:hover { opacity: 0.8; }
.node-label { font-size: 11px; fill: #ccc; pointer-events: none; text-anchor: middle; }
.edge { stroke: #333; stroke-width: 0.7; fill: none; pointer-events: none; opacity: 0.55; }
.edge-label { font-size: 9px; fill: #666; pointer-events: none; text-anchor: middle; }
.highlighted { opacity: 1 !important; }
.dimmed { opacity: 0.15; }
#tooltip { position: fixed; padding: 8px 12px; background: #0f3460; border: 1px solid #e94560; border-radius: 4px; font-size: 12px; color: #eee; pointer-events: none; z-index: 20; display: none; max-width: 300px; }
#legend { position: fixed; bottom: 12px; left: 12px; padding: 8px 12px; background: #16213e; border: 1px solid #0f3460; border-radius: 4px; font-size: 11px; z-index: 10; }
.legend-item { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>${escapeHtml(title)}</h1>
  <input id="search" type="text" placeholder="Search nodes..." />
  <select id="filter">
    <option value="">All types</option>
    <option value="entity">Entity</option>
    <option value="fact">Fact</option>
    <option value="profile">Profile</option>
    <option value="event">Event</option>
    <option value="concept">Concept</option>
  </select>
  <select id="cluster" title="Cluster nodes by type or first tag">
    <option value="">No clusters</option>
    <option value="type">Cluster: type</option>
    <option value="tag">Cluster: tag</option>
  </select>
  <select id="depth" title="Show only the neighborhood of the clicked node">
    <option value="0">All nodes</option>
    <option value="1">Neighborhood: 1</option>
    <option value="2">Neighborhood: 2</option>
  </select>
  <span id="stats"></span>
</div>
<div id="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#4A90D9"></div>Entity</div>
  <div class="legend-item"><div class="legend-dot" style="background:#50C878"></div>Fact</div>
  <div class="legend-item"><div class="legend-dot" style="background:#FF6B6B"></div>Profile</div>
  <div class="legend-item"><div class="legend-dot" style="background:#FFB347"></div>Event</div>
  <div class="legend-item"><div class="legend-dot" style="background:#9B59B6"></div>Concept</div>
</div>
<div id="tooltip"></div>
<svg id="graph"></svg>
<script>
const NODES = ${nodesJson};
const EDGES = ${edgesJson};
const WIDTH = ${width};
const HEIGHT = ${height};
const NODE_R = ${nodeRadius};
const CHARGE = ${charge};
const LINK_DIST = ${linkDistance};
const SHOW_LABELS = ${showLabels};

const svg = document.getElementById('graph');
svg.setAttribute('viewBox', '0 0 ' + WIDTH + ' ' + HEIGHT);
const tooltip = document.getElementById('tooltip');
const stats = document.getElementById('stats');
const search = document.getElementById('search');
const filter = document.getElementById('filter');

const ALL_NODES = NODES;
const ALL_EDGES = EDGES;
const MAX_NODES = 300;
const MAX_LABELS = 18;
const clusterSelect = document.getElementById('cluster');
const depthSelect = document.getElementById('depth');

const fullAdj = new Map(ALL_NODES.map(n => [n.id, []]));
ALL_EDGES.forEach(e => { fullAdj.get(e.source)?.push(e.target); fullAdj.get(e.target)?.push(e.source); });
const degree = new Map(ALL_NODES.map(n => [n.id, (fullAdj.get(n.id) || []).length]));

let clusterMode = '';
let depth = 0;
let focusId = null;
let expanded = new Set();
let nodes = [];
let edges = [];
let viewById = new Map();
let labelIds = new Set();
let ticks = 0;
let running = true;
let frame = 0;

function colorOf(type) {
  return ({ entity: '#4A90D9', fact: '#50C878', profile: '#FF6B6B', event: '#FFB347', concept: '#9B59B6' })[type] || '#888';
}

function focusSet(seed, maxDepth) {
  const seen = new Set([seed]);
  let frontier = [seed];
  for (let d = 0; d < maxDepth; d++) {
    const next = [];
    frontier.forEach(id => (fullAdj.get(id) || []).forEach(other => {
      if (!seen.has(other) && ALL_NODES.some(n => n.id === other)) { seen.add(other); next.push(other); }
    }));
    frontier = next;
  }
  return seen;
}

function clusterKey(node) {
  if (clusterMode === 'type') return node.type;
  if (clusterMode === 'tag') return (node.tags && node.tags[0]) || 'untagged';
  return '';
}

function buildView() {
  let source = ALL_NODES.slice();
  if (focusId && depth > 0) {
    const keep = focusSet(focusId, depth);
    source = source.filter(n => keep.has(n.id));
  }
  source.sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.id.localeCompare(b.id));
  source = source.slice(0, MAX_NODES);

  const sourceIds = new Set(source.map(n => n.id));
  let viewNodes = source.map(n => ({ ...n }));
  let viewEdges = ALL_EDGES.filter(e => sourceIds.has(e.source) && sourceIds.has(e.target)).map(e => ({ ...e }));

  if (clusterMode) {
    const members = new Map();
    source.forEach(n => {
      const key = clusterKey(n);
      if (!expanded.has(key)) {
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(n);
      }
    });
    const clusterOf = new Map();
    const clusters = [];
    members.forEach((group, key) => {
      if (group.length < 2) return;
      const id = 'cluster:' + clusterMode + ':' + key;
      group.forEach(n => clusterOf.set(n.id, id));
      clusters.push({ id: id, label: key + ' (' + group.length + ')', type: 'concept', color: '#E94560', clusterKey: key, factCount: group.length, memberIds: group.map(n => n.id) });
    });
    if (clusters.length) {
      viewNodes = viewNodes.filter(n => !clusterOf.has(n.id)).concat(clusters);
      const aggregated = new Map();
      viewEdges.forEach(e => {
        const source2 = clusterOf.get(e.source) || e.source;
        const target2 = clusterOf.get(e.target) || e.target;
        if (source2 === target2) return;
        const key = source2 + '|' + target2;
        if (!aggregated.has(key)) aggregated.set(key, { source: source2, target: target2, weight: 0 });
        aggregated.get(key).weight += 1;
      });
      viewEdges = Array.from(aggregated.values());
    }
  }

  const viewIds = new Set(viewNodes.map(n => n.id));
  viewEdges = viewEdges.filter(e => viewIds.has(e.source) && viewIds.has(e.target));
  viewById = new Map(viewNodes.map(n => [n.id, n]));
  viewEdges = viewEdges.map(e => ({ ...e, s: viewById.get(e.source), t: viewById.get(e.target) })).filter(e => e.s && e.t);

  nodes = viewNodes.map((n, index) => {
    const angle = (index / Math.max(1, viewNodes.length)) * Math.PI * 2 + (index % 4) * 0.09;
    const ring = Math.min(WIDTH, HEIGHT) * (0.16 + 0.3 * ((index % 4) / 4));
    return { ...n, x: WIDTH / 2 + Math.cos(angle) * ring, y: HEIGHT / 2 + Math.sin(angle) * ring, vx: 0, vy: 0 };
  });
  edges = viewEdges;

  const ranked = nodes.slice().sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
  labelIds = new Set(ranked.slice(0, MAX_LABELS).map(n => n.id));
  if (focusId) labelIds.add(focusId);
  ticks = 0;
  frame = 0;
}

function tick() {
  const local = nodes;
  for (const n of local) {
    let fx = 0, fy = 0;
    for (const m of local) {
      if (n === m) continue;
      const dx = n.x - m.x, dy = n.y - m.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = CHARGE / (d * d);
      fx += dx / d * f; fy += dy / d * f;
    }
    (fullAdj.get(n.id) || []).forEach(id => {
      const m = viewById.get(id);
      if (!m) return;
      const dx = m.x - n.x, dy = m.y - n.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - LINK_DIST) * 0.1;
      fx += dx / d * f; fy += dy / d * f;
    });
    n.vx = (n.vx + fx) * 0.85; n.vy = (n.vy + fy) * 0.85; n.x += n.vx; n.y += n.vy;
    n.x = Math.max(NODE_R, Math.min(WIDTH - NODE_R, n.x));
    n.y = Math.max(NODE_R + 50, Math.min(HEIGHT - NODE_R, n.y));
  }
  frame += 1;
  if (frame % 2 === 0) render();
  ticks += 1;
  if (running && ticks < 160) requestAnimationFrame(tick);
  else { running = false; render(); }
}

function render() {
  let html = '';
  edges.forEach(e => { html += '<line class="edge" x1="' + e.s.x + '" y1="' + e.s.y + '" x2="' + e.t.x + '" y2="' + e.t.y + '"/>'; });
  const placed = [];
  nodes.forEach(n => {
    const isCluster = !!n.clusterKey;
    const r = isCluster ? NODE_R + 4 : NODE_R;
    html += '<circle class="node" cx="' + n.x + '" cy="' + n.y + '" r="' + r + '" fill="' + (n.color || '#888') + '" data-id="' + n.id + '"/>';
    if (!SHOW_LABELS || !(labelIds.has(n.id) || isCluster)) return;
    const width = Math.min(240, n.label.length * 6.6 + 8);
    const box = { x: n.x - width / 2, y: n.y + r + 2, w: width, h: 14 };
    if (placed.some(p => !(box.x + box.w < p.x || p.x + p.w < box.x || box.y + box.h < p.y || p.y + p.h < box.y))) return;
    placed.push(box);
    html += '<text class="node-label" x="' + n.x + '" y="' + (n.y + r + 14) + '">' + escapeLabel(n.label) + '</text>';
  });
  svg.innerHTML = html;
  const scope = focusId ? ' · depth ' + depth + ' around ' + focusId.slice(0, 12) : '';
  stats.textContent = 'Showing ' + nodes.length + ' of ' + ALL_NODES.length + ' nodes / ' + edges.length + ' edges' + scope;
  svg.querySelectorAll('.node').forEach(el => {
    const n = viewById.get(el.dataset.id);
    if (!n) return;
    el.addEventListener('mouseenter', e => { tooltip.style.display = 'block'; tooltip.innerHTML = '<b>' + escapeHtml(n.label) + '</b><br>Type: ' + n.type + (n.clusterKey ? '<br>' + (n.memberIds || []).length + ' nodes — click to expand' : '') + (n.tags ? '<br>Tags: ' + n.tags.join(', ') : ''); moveTooltip(e); });
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    el.addEventListener('click', () => {
      if (n.clusterKey) { expanded.add(n.clusterKey); buildView(); start(); return; }
      focusId = n.id;
      if (depth > 0) { buildView(); start(); } else { highlight(n.id); }
    });
  });
}

function moveTooltip(e) { tooltip.style.left = (e.clientX + 14) + 'px'; tooltip.style.top = (e.clientY + 14) + 'px'; }

function highlight(id) {
  const neighbors = new Set([id]);
  (fullAdj.get(id) || []).forEach(n => neighbors.add(n));
  svg.querySelectorAll('.node, .edge').forEach(el => { el.classList.remove('highlighted', 'dimmed'); });
  svg.querySelectorAll('.node').forEach(el => { if (!neighbors.has(el.dataset.id)) el.classList.add('dimmed'); else el.classList.add('highlighted'); });
}

function escapeLabel(s) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 30); }
function escapeHtml(s) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function start() {
  running = true;
  if (ALL_NODES.length > 30) {
    render();
    running = false;
    return;
  }
  tick();
}

search.addEventListener('input', () => {
  const q = search.value.toLowerCase();
  if (!q) { svg.querySelectorAll('.node, .edge').forEach(el => { el.classList.remove('highlighted', 'dimmed'); }); return; }
  const matches = new Set(nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
  svg.querySelectorAll('.node').forEach(el => { if (matches.has(el.dataset.id)) { el.classList.add('highlighted'); el.classList.remove('dimmed'); } else { el.classList.add('dimmed'); el.classList.remove('highlighted'); } });
});

filter.addEventListener('change', () => {
  const t = filter.value;
  if (!t) { svg.querySelectorAll('.node').forEach(el => { el.style.opacity = 1; }); return; }
  svg.querySelectorAll('.node').forEach(el => { const n = viewById.get(el.dataset.id); el.style.opacity = (n && n.type === t) ? 1 : 0.1; });
});

clusterSelect.addEventListener('change', () => {
  clusterMode = clusterSelect.value;
  expanded = new Set();
  buildView();
  start();
});

depthSelect.addEventListener('change', () => {
  depth = Number(depthSelect.value);
  if (focusId) { buildView(); start(); }
});

buildView();
start();

</script>
</body>
</html>`;
}

export function buildGraphFromFacts(
  facts: Array<{ id: string; title: string; content: string; tags?: string[] }>,
  relationships?: Array<{ source: string; target: string; label?: string }>,
): GraphData {
  const nodes: GraphNode[] = facts.map((f) => ({
    id: f.id,
    label: f.title,
    type: 'fact',
    tags: f.tags,
  }));
  const edges: GraphEdge[] = relationships ?? [];
  return { nodes, edges };
}

export function generateGraphFile(
  data: GraphData,
  outputPath: string,
  opts?: VizOptions,
): string {
  const html = generateGraphHTML(data, opts);
  return html;
}

export function graphStats(data: GraphData): {
  nodes: number;
  edges: number;
  byType: Record<string, number>;
  density: number;
  avgDegree: number;
} {
  const byType: Record<string, number> = {};
  for (const n of data.nodes) {
    byType[n.type] = (byType[n.type] ?? 0) + 1;
  }
  const degreeMap = new Map<string, number>();
  for (const e of data.edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }
  const totalDegree = Array.from(degreeMap.values()).reduce((s, d) => s + d, 0);
  const avgDegree = data.nodes.length > 0 ? totalDegree / data.nodes.length : 0;
  const maxEdges = (data.nodes.length * (data.nodes.length - 1)) / 2;
  const density = maxEdges > 0 ? data.edges.length / maxEdges : 0;
  return {
    nodes: data.nodes.length,
    edges: data.edges.length,
    byType,
    density: Math.round(density * 1000) / 1000,
    avgDegree: Math.round(avgDegree * 100) / 100,
  };
}
