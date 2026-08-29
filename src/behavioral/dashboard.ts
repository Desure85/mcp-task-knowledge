/**
 * behavioral/dashboard.ts — Behavioral dashboard aggregator + HTML generator (BM-011)
 *
 * Zero-dependency: reads the behavioral JSON stores (.behavioral/intents.json,
 * failures.json, resolutions.json) and produces:
 *   - 90-day error-rate trend (daily buckets)
 *   - fix effectiveness (which approaches succeed)
 *   - event timeline (intents/failures/resolutions/runtime)
 * Plus a single-file dark-themed HTML page with auto-refresh.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IntentRecord } from './intent-capture.js';
import type { FailureRecord } from './failure-logging.js';
import type { ResolutionRecord } from './resolution-logging.js';

export interface DashboardOptions {
  /** Directory containing intents.json / failures.json / resolutions.json. */
  storagePath?: string;
  /** Trend window in days (default: 90). */
  trendDays?: number;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  intents: number;
  failures: number;
  resolutions: number;
  errorRate: number; // failures / max(intents,1) as fraction
}

export interface ApproachStat {
  approach: string;
  total: number;
  resolved: number;
  successRate: number; // fraction 0..1
}

export interface TimelineEvent {
  ts: string;
  kind: 'intent' | 'failure' | 'resolution';
  label: string;
}

export interface DashboardData {
  generatedAt: string;
  totals: {
    intents: number;
    failures: number;
    resolutions: number;
    errorRate: number;
  };
  trends: TrendPoint[];
  approaches: ApproachStat[];
  timeline: TimelineEvent[];
}

function readJson<T>(file: string): T[] {
  try {
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, 'utf8')) as T[];
  } catch {
    return [];
  }
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Aggregates behavioral memory into dashboard-ready statistics.
 * Never throws — missing/corrupt stores yield empty data.
 */
export class BehavioralDashboard {
  private readonly storagePath: string;
  private readonly trendDays: number;

  constructor(options: DashboardOptions = {}) {
    this.storagePath = options.storagePath ?? '.behavioral';
    this.trendDays = options.trendDays ?? 90;
  }

  /** Compute all dashboard statistics. */
  compute(): DashboardData {
    const intents = readJson<IntentRecord>(join(this.storagePath, 'intents.json'));
    const failures = readJson<FailureRecord>(join(this.storagePath, 'failures.json'));
    const resolutions = readJson<ResolutionRecord>(join(this.storagePath, 'resolutions.json'));

    // ── 90-day trend ──
    const now = Date.now();
    const dayMs = 86_400_000;
    const buckets = new Map<string, TrendPoint>();
    for (let i = this.trendDays - 1; i >= 0; i--) {
      const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
      buckets.set(d, { date: d, intents: 0, failures: 0, resolutions: 0, errorRate: 0 });
    }
    for (const it of intents) {
      const k = dayKey(it.timestamp);
      const b = buckets.get(k);
      if (b) b.intents++;
    }
    for (const f of failures) {
      const k = dayKey(f.timestamp);
      const b = buckets.get(k);
      if (b) b.failures++;
    }
    for (const r of resolutions) {
      const k = dayKey(r.timestamp);
      const b = buckets.get(k);
      if (b) b.resolutions++;
    }
    for (const b of buckets.values()) {
      b.errorRate = b.intents > 0 ? b.failures / b.intents : 0;
    }

    // ── Fix effectiveness by approach ──
    const byApproach = new Map<string, { total: number; resolved: number }>();
    for (const r of resolutions) {
      const s = byApproach.get(r.approach) ?? { total: 0, resolved: 0 };
      s.total++;
      // A resolution with a commitSha counts as actually fixed
      if (r.commitSha) s.resolved++;
      byApproach.set(r.approach, s);
    }
    const approaches: ApproachStat[] = [...byApproach.entries()].map(([approach, s]) => ({
      approach,
      total: s.total,
      resolved: s.resolved,
      successRate: s.total > 0 ? s.resolved / s.total : 0,
    })).sort((a, b) => b.total - a.total);

    // ── Event timeline (newest first) ──
    const timeline: TimelineEvent[] = [
      ...intents.map((it) => ({ ts: it.timestamp, kind: 'intent' as const, label: `${it.file} — ${it.prompt.slice(0, 80)}` })),
      ...failures.map((f) => ({ ts: f.timestamp, kind: 'failure' as const, label: `${f.errorType}: ${f.message.slice(0, 80)}` })),
      ...resolutions.map((r) => ({ ts: r.timestamp, kind: 'resolution' as const, label: `${r.approach.slice(0, 80)}${r.commitSha ? ' ✓' : ''}` })),
    ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200);

    const totalFailures = failures.length;
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        intents: intents.length,
        failures: totalFailures,
        resolutions: resolutions.length,
        errorRate: intents.length > 0 ? totalFailures / intents.length : 0,
      },
      trends: [...buckets.values()],
      approaches,
      timeline,
    };
  }

  /**
   * Render a self-contained dark-themed HTML page.
   * Zero dependencies: inline CSS + vanilla JS, auto-refreshes every 30s.
   */
  toHtml(): string {
    const data = this.compute();
    const trends = JSON.stringify(data.trends);
    const approaches = JSON.stringify(data.approaches);
    const timeline = JSON.stringify(data.timeline);
    const totals = JSON.stringify(data.totals);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Behavioral Dashboard</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0d1117; color:#c9d1d9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin:0; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#8b949e; font-size:12px; margin-bottom:20px; }
  .cards { display:flex; gap:16px; margin-bottom:24px; flex-wrap:wrap; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px 20px; min-width:140px; }
  .card .num { font-size:28px; font-weight:700; }
  .card .lbl { color:#8b949e; font-size:12px; margin-top:4px; }
  .card.err .num { color:#f85149; }
  section { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px 20px; margin-bottom:24px; }
  h2 { font-size:14px; margin:0 0 12px; color:#e6edf3; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #21262d; }
  th { color:#8b949e; font-weight:600; }
  .bar { background:#238636; border-radius:3px; height:14px; }
  .bar.low { background:#d29922; }
  .bar.hi { background:#f85149; }
  .tl { max-height:400px; overflow-y:auto; }
  .tl div { padding:4px 0; border-bottom:1px solid #21262d; font-size:12px; }
  .kind-intent { color:#58a6ff; }
  .kind-failure { color:#f85149; }
  .kind-resolution { color:#3fb950; }
  #chart { width:100%; height:160px; }
</style>
</head>
<body>
<h1>Behavioral Dashboard</h1>
<div class="sub">Generated <span id="gen"></span> · auto-refresh 30s</div>
<div class="cards" id="cards"></div>
<section><h2>Error Rate — 90 days (failures / intents)</h2><canvas id="chart"></canvas></section>
<section><h2>Fix Effectiveness by Approach</h2><table id="approaches"></table></section>
<section><h2>Event Timeline</h2><div class="tl" id="timeline"></div></section>
<script>
const TRENDS = ${trends};
const APPROACHES = ${approaches};
const TIMELINE = ${timeline};
const TOTALS = ${totals};
const fmt = (n) => (Math.round(n * 100) / 100).toString();
const render = () => {
  document.getElementById('gen').textContent = new Date().toLocaleString();
  const cards = document.getElementById('cards');
  const mk = (num, lbl, cls) => '<div class="card ' + (cls||'') + '"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
  cards.innerHTML = mk(TOTALS.intents,'Intents') + mk(TOTALS.failures,'Failures','err') + mk(TOTALS.resolutions,'Resolutions') + mk(fmt(TOTALS.errorRate*100)+'%','Overall error rate');
  const tbl = document.getElementById('approaches');
  tbl.innerHTML = '<tr><th>Approach</th><th>Total</th><th>Resolved</th><th>Success</th></tr>' + APPROACHES.map(a =>
    '<tr><td>' + a.approach + '</td><td>' + a.total + '</td><td>' + a.resolved + '</td><td>' + fmt(a.successRate*100) + '%</td></tr>').join('');
  const tl = document.getElementById('timeline');
  tl.innerHTML = TIMELINE.map(e => '<div class="kind-' + e.kind + '">[' + e.kind + '] ' + e.label + ' <span style="color:#8b949e">' + e.ts + '</span></div>').join('');
  const cv = document.getElementById('chart');
  const ctx = cv.getContext('2d');
  const w = cv.width = cv.offsetWidth || 800, h = cv.height = 160;
  ctx.clearRect(0,0,w,h);
  const max = Math.max(1, ...TRENDS.map(t => Math.max(t.intents, t.failures)));
  ctx.strokeStyle = '#8b949e'; ctx.fillStyle = '#58a6ff';
  TRENDS.forEach((t, i) => {
    const x = (i / Math.max(1, TRENDS.length - 1)) * (w - 20) + 10;
    const yi = h - 10 - (t.intents / max) * (h - 30);
    const yf = h - 10 - (t.failures / max) * (h - 30);
    ctx.fillRect(x - 1, yi, 2, (h - 10) - yi);
    ctx.fillStyle = '#f85149'; ctx.fillRect(x - 1, yf, 2, (h - 10) - yf); ctx.fillStyle = '#58a6ff';
  });
};
render();
setInterval(render, 30000);
</script>
</body>
</html>`;
  }
}
