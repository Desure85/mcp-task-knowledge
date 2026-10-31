#!/usr/bin/env node
/**
 * scripts/bench/graph-bench.mjs — SVG graph render cost vs node count.
 *
 * Generates the self-contained graph HTML that `graph_visualize` returns
 * (src/memory/graph-viz.ts:generateGraphHTML) for synthetic graphs of N nodes, then
 * renders it in Chromium and measures DOM/SVG size, time-to-settle, Long Tasks, heap
 * and (optionally) screenshots.
 *
 * Seeding is in-process: entity-graph population via extraction is a separate concern;
 * this benchmark isolates the viz layer, which is what the UI pays on every open.
 *
 * NOT part of CI and NOT part of `npm test`.
 *
 * Usage:
 *   node scripts/bench/graph-bench.mjs --sizes 76,200,1000,5000 \
 *     --playwright /home/dm/work/qa/node_modules/playwright-core \
 *     --out-dir /tmp/graph-bench
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const out = {
    sizes: [76, 200, 1000, 5000],
    playwright: '',
    outDir: '/tmp/mcp-graph-bench',
    chrome: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    timeoutMs: 120_000,
    shots: [76, 1000],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--sizes': out.sizes = next().split(',').map(Number); break;
      case '--shots': out.shots = next().split(',').map(Number); break;
      case '--playwright': out.playwright = next(); break;
      case '--out-dir': out.outDir = next(); break;
      case '--chrome': out.chrome = next(); break;
      case '--timeout': out.timeoutMs = Number(next()); break;
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.playwright) throw new Error('--playwright <path to playwright-core> is required');
  return out;
}

async function loadChromium(dir) {
  for (const c of [path.join(dir, 'index.mjs'), path.join(dir, 'index.js')]) {
    try {
      await fs.access(c);
      const mod = await import(pathToFileURL(c).href);
      return mod.chromium ?? mod.default?.chromium;
    } catch {}
  }
  throw new Error(`cannot load playwright-core from ${dir}`);
}

/** Deterministic graph: N nodes, ~1.4N edges, a hub-heavy tail like real entity graphs. */
function makeGraph(n) {
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push({ id: `n${i}`, label: `Entity ${i}`, type: 'entity' });
  const edges = [];
  for (let i = 1; i < n; i++) {
    // ring backbone + a shortcut to an early hub → connected, not a tree
    edges.push({ source: `n${i}`, target: `n${i - 1}`, label: 'dependsOn' });
    if (i % 3 === 0) edges.push({ source: `n${i}`, target: `n${i % Math.max(2, Math.floor(n / 20))}`, label: 'dependentOf' });
    if (i % 7 === 0) edges.push({ source: `n${i}`, target: `n${i - Math.min(i, 5)}`, label: 'dependsOn' });
  }
  return { nodes, edges };
}

const INIT = `
  window.__longTasks = []; window.__ltTotal = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__longTasks.push(Math.round(e.duration)); window.__ltTotal += e.duration; } }).observe({ entryTypes: ['longtask'] }); } catch {}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { generateGraphHTML } = await import('../../dist/memory/graph-viz.js');
  const chromium = await loadChromium(args.playwright);
  await fs.mkdir(args.outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: args.chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = { ok: true, sizes: {}, startedAt: new Date().toISOString() };

  try {
    for (const n of args.sizes) {
      const data = makeGraph(n);
      const t0 = Date.now();
      const html = generateGraphHTML(data, { title: `Graph ${n}` });
      const genMs = Date.now() - t0;
      const file = path.join(args.outDir, `graph-${n}.html`);
      await fs.writeFile(file, html, 'utf8');

      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      await context.addInitScript(INIT);
      const page = await context.newPage();
      const navStart = Date.now();
      let timedOut = false;
      let err = null;
      try {
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: args.timeoutMs });
        // wait for the layout to stop mutating the SVG
        const deadline = Date.now() + args.timeoutMs;
        let last = -1;
        let stable = 0;
        while (Date.now() < deadline) {
          const c = await page.evaluate(() => document.querySelectorAll('svg *').length).catch(() => -1);
          if (c === last) {
            if (stable && Date.now() - stable >= 1500) break;
            if (!stable) stable = Date.now();
          } else {
            last = c;
            stable = 0;
          }
          await page.waitForTimeout(100);
        }
        if (Date.now() >= deadline) timedOut = true;
      } catch (e) {
        if (/Timeout/i.test(String(e?.message))) timedOut = true;
        else err = String(e?.message || e);
      }
      const settleMs = Date.now() - navStart;
      const m = await page
        .evaluate(() => ({
          domNodes: document.querySelectorAll('*').length,
          svgNodes: document.querySelectorAll('svg *').length,
          svgCircles: document.querySelectorAll('svg circle').length,
          svgLines: document.querySelectorAll('svg line, svg path').length,
          longTasks: window.__longTasks?.length ?? 0,
          longTaskTotalMs: Math.round(window.__ltTotal || 0),
          longTaskMaxMs: window.__longTasks?.length ? Math.max(...window.__longTasks) : 0,
          heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        }))
        .catch(() => ({}));

      if (args.shots.includes(n)) {
        const shot = path.join(args.outDir, `graph-${n}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      }
      await context.close();

      results.sizes[n] = {
        nodes: data.nodes.length,
        edges: data.edges.length,
        htmlBytes: Buffer.byteLength(html),
        generateMs: genMs,
        settleMs,
        timedOut,
        error: err,
        ...m,
      };
      process.stderr.write(
        `  n=${String(n).padEnd(6)} html=${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB  gen=${genMs} ms  settle=${settleMs} ms  svg=${m.svgNodes}  longTasks=${m.longTaskTotalMs} ms  heap=${m.heapMb} MB${timedOut ? '  TIMEOUT' : ''}\n`,
      );
    }
  } finally {
    await browser.close();
  }

  const out = path.join(args.outDir, 'graph-bench.json');
  await fs.writeFile(out, JSON.stringify(results, null, 2), 'utf8');
  console.log(JSON.stringify(results, null, 2));
  console.error(`results → ${out}`);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
