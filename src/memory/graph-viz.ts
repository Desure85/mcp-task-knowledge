/**
 * graph-viz.ts — Interactive knowledge graph visualization (NEXT-014).
 *
 * Generates a self-contained HTML file with an interactive knowledge graph.
 * Nodes = entities/facts, edges = relationships. Supports filter, search,
 * expand, and force-directed layout — zero dependencies, pure SVG + JS.
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';

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
#filter { padding: 6px 12px; background: #0f3460; border: 1px solid #1a1a4e; color: #eee; border-radius: 4px; font-size: 13px; cursor: pointer; }
#stats { font-size: 12px; color: #888; white-space: nowrap; }
#graph { width: 100vw; height: 100vh; }
.node { cursor: pointer; transition: opacity 0.2s; }
.node:hover { opacity: 0.8; }
.node-label { font-size: 11px; fill: #ccc; pointer-events: none; text-anchor: middle; }
.edge { stroke: #333; stroke-width: 1.5; fill: none; pointer-events: none; }
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

const nodeMap = new Map(NODES.map(n => [n.id, n]));
const adj = new Map(NODES.map(n => [n.id, []]));
EDGES.forEach(e => { adj.get(e.source)?.push(e.target); adj.get(e.target)?.push(e.source); });

const nodes = NODES.map(n => ({ ...n, x: WIDTH/2 + (Math.random()-0.5)*200, y: HEIGHT/2 + (Math.random()-0.5)*200, vx: 0, vy: 0 }));
const edges = EDGES.map(e => ({ ...e, s: nodes.find(n=>n.id===e.source), t: nodes.find(n=>n.id===e.target) })).filter(e => e.s && e.t);

function tick() {
  for (let i = 0; i < 3; i++) {
    nodes.forEach(n => {
      let fx = 0, fy = 0;
      nodes.forEach(m => { if (n === m) return; const dx = n.x - m.x, dy = n.y - m.y; const d = Math.max(1, Math.sqrt(dx*dx+dy*dy)); const f = CHARGE / (d*d); fx += dx/d*f; fy += dy/d*f; });
      adj.get(n.id)?.forEach(id => { const m = nodes.find(x => x.id === id); if (!m) return; const dx = m.x - n.x, dy = m.y - n.y; const d = Math.max(1, Math.sqrt(dx*dx+dy*dy)); const f = (d - LINK_DIST) * 0.1; fx += dx/d*f; fy += dy/d*f; });
      n.vx = (n.vx + fx) * 0.85; n.vy = (n.vy + fy) * 0.85; n.x += n.vx; n.y += n.vy;
      n.x = Math.max(NODE_R, Math.min(WIDTH - NODE_R, n.x)); n.y = Math.max(NODE_R + 50, Math.min(HEIGHT - NODE_R, n.y));
    });
  }
  render();
  if (running) requestAnimationFrame(tick);
}

let running = true;
function render() {
  let html = '';
  edges.forEach(e => { html += '<line class="edge" x1="'+e.s.x+'" y1="'+e.s.y+'" x2="'+e.t.x+'" y2="'+e.t.y+'"/>'; });
  nodes.forEach(n => {
    html += '<circle class="node" cx="'+n.x+'" cy="'+n.y+'" r="'+NODE_R+'" fill="'+(n.color||'#888')+'" data-id="'+n.id+'"/>';
    if (SHOW_LABELS) html += '<text class="node-label" x="'+n.x+'" y="'+(n.y+NODE_R+14)+'">'+escapeLabel(n.label)+'</text>';
  });
  svg.innerHTML = html;
  stats.textContent = nodes.length + ' nodes / ' + edges.length + ' edges';
  svg.querySelectorAll('.node').forEach(el => {
    el.addEventListener('mouseenter', e => { const n = nodes.find(x => x.id === el.dataset.id); if (!n) return; tooltip.style.display = 'block'; tooltip.innerHTML = '<b>'+escapeHtml(n.label)+'</b><br>Type: '+n.type+(n.tags?'<br>Tags: '+n.tags.join(', '):''); moveTooltip(e); });
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    el.addEventListener('click', () => { highlight(el.dataset.id); });
  });
}

function moveTooltip(e) { tooltip.style.left = (e.clientX + 14) + 'px'; tooltip.style.top = (e.clientY + 14) + 'px'; }

function highlight(id) {
  const neighbors = new Set([id]); adj.get(id)?.forEach(n => neighbors.add(n));
  svg.querySelectorAll('.node, .edge').forEach(el => { el.classList.remove('highlighted', 'dimmed'); });
  svg.querySelectorAll('.node').forEach(el => { if (!neighbors.has(el.dataset.id)) el.classList.add('dimmed'); else el.classList.add('highlighted'); });
}

function escapeLabel(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').substring(0, 30); }
function escapeHtml(s) { return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

search.addEventListener('input', () => {
  const q = search.value.toLowerCase();
  if (!q) { svg.querySelectorAll('.node, .edge').forEach(el => { el.classList.remove('highlighted','dimmed'); }); return; }
  const matches = new Set(nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id));
  svg.querySelectorAll('.node').forEach(el => { if (matches.has(el.dataset.id)) { el.classList.add('highlighted'); el.classList.remove('dimmed'); } else { el.classList.add('dimmed'); el.classList.remove('highlighted'); } });
});

filter.addEventListener('change', () => {
  const t = filter.value;
  if (!t) { svg.querySelectorAll('.node').forEach(el => { el.style.opacity = 1; }); return; }
  svg.querySelectorAll('.node').forEach(el => { const n = nodes.find(x => x.id === el.dataset.id); el.style.opacity = (n && n.type === t) ? 1 : 0.1; });
});

tick();
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
