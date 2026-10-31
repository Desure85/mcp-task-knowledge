#!/usr/bin/env node
/**
 * scripts/bench/ui-bench.mjs — browser-side cost of list pages at scale.
 *
 * Measures what the Web UI actually pays when the board / knowledge page loads a
 * whole collection: JSON-RPC response bytes on the wire, time to data-loaded, DOM
 * node count, main-thread Long Tasks and JS heap.
 *
 * Requires a running MCP server and a running `next dev` for the UI; the script only
 * drives the browser. playwright-core is taken from --playwright (an existing
 * install on the machine) — nothing is added to package.json.
 *
 * NOT part of CI and NOT part of `npm test`.
 *
 * Usage:
 *   node scripts/bench/ui-bench.mjs --base http://127.0.0.1:3440 \
 *     --playwright /home/dm/work/qa/node_modules/playwright-core \
 *     --pages tasks,knowledge --label n=10000 --out /tmp/ui-10000.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const out = {
    base: 'http://127.0.0.1:3440',
    playwright: '',
    user: 'bench',
    pass: 'bench-password',
    pages: ['tasks', 'knowledge'],
    label: '',
    out: '',
    timeoutMs: 120_000,
    chrome: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--base': out.base = next(); break;
      case '--playwright': out.playwright = next(); break;
      case '--user': out.user = next(); break;
      case '--pass': out.pass = next(); break;
      case '--pages': out.pages = next().split(',').map((s) => s.trim()); break;
      case '--label': out.label = next(); break;
      case '--out': out.out = next(); break;
      case '--timeout': out.timeoutMs = Number(next()); break;
      case '--chrome': out.chrome = next(); break;
      case '--headed': out.headed = true; break;
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.playwright) throw new Error('--playwright <path to playwright-core> is required');
  return out;
}

async function loadChromium(playwrightDir) {
  // Accept either the package directory or its index file.
  const candidates = [
    path.join(playwrightDir, 'index.mjs'),
    path.join(playwrightDir, 'index.js'),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      const mod = await import(pathToFileURL(c).href);
      return mod.chromium ?? mod.default?.chromium;
    } catch {}
  }
  throw new Error(`cannot load playwright-core from ${playwrightDir}`);
}

const INIT_SCRIPT = `
  window.__longTasks = [];
  window.__ltTotal = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longTasks.push(Math.round(e.duration));
        window.__ltTotal += e.duration;
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chromium = await loadChromium(args.playwright);
  const browser = await chromium.launch({
    executablePath: args.chrome,
    headless: !args.headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const result = {
    ok: true,
    label: args.label,
    base: args.base,
    startedAt: new Date().toISOString(),
    pages: {},
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(INIT_SCRIPT);
    const page = await context.newPage();

    // ── login (username/password → JWT stored for the tab)
    await page.goto(`${args.base}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
    // Controlled inputs only become interactive after hydration; typing (not fill)
    // guarantees React sees the change and enables the submit button.
    const userInput = page.locator('input[autocomplete="username"]');
    const passInput = page.locator('input[autocomplete="current-password"]');
    await userInput.click();
    await userInput.type(args.user, { delay: 15 });
    await passInput.click();
    await passInput.type(args.pass, { delay: 15 });
    await page.locator('button[type="submit"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const b = document.querySelector('button[type="submit"]');
        return b && !b.disabled;
      },
      undefined,
      { timeout: 30_000 },
    );
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });

    for (const name of args.pages) {
      const mcp = [];
      const onResponse = async (r) => {
        if (r.request().method() !== 'POST' || !r.url().includes('/api/mcp')) return;
        const startedAt = Date.now();
        const ct = (r.headers()['content-type'] || '').toLowerCase();
        if (ct.includes('text/event-stream')) {
          // Streaming responses never "finish"; reading the body would hang the probe.
          mcp.push({ bytes: -1, status: r.status(), atMs: startedAt, sse: true });
          return;
        }
        try {
          const buf = await r.body();
          mcp.push({ bytes: buf.length, status: r.status(), atMs: startedAt });
        } catch {
          mcp.push({ bytes: -1, status: r.status(), atMs: startedAt });
        }
      };
      page.on('response', onResponse);

      const t0 = Date.now();
      let timedOut = false;
      let navError = null;
      let firstMcpMs = null;
      let lastChangeMs = 0;
      try {
        await page.goto(`${args.base}/${name}`, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
        // SPA: data arrives after hydration, so networkidle is meaningless. Wait until
        // the DOM node count stops changing (render settled) with a hard cap.
        const deadline = Date.now() + args.timeoutMs;
        let lastCount = -1;
        let stableSince = 0;
        while (Date.now() < deadline) {
          const count = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => -1);
          if (mcp.length > 0 && firstMcpMs === null) firstMcpMs = Date.now() - t0;
          if (count === lastCount && mcp.length >= 2 && Date.now() - t0 > 2500) {
            if (stableSince && Date.now() - stableSince >= 3000) break;
            if (!stableSince) stableSince = Date.now();
          } else {
            lastCount = count;
            stableSince = 0;
            lastChangeMs = Date.now() - t0;
          }
          await page.waitForTimeout(100);
        }
        if (Date.now() >= deadline) timedOut = true;
      } catch (err) {
        if (/Timeout/i.test(String(err?.message))) timedOut = true;
        else navError = String(err?.message || err);
      }
      const dataLoadedMs = Date.now() - t0;
      const domSettledMs = lastChangeMs;

      const metrics = await page
        .evaluate(() => {
          const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
          return {
            domNodes: document.querySelectorAll('*').length,
            cards: document.querySelectorAll('[draggable="true"]').length,
            longTasks: window.__longTasks ? window.__longTasks.length : 0,
            longTaskMaxMs: window.__longTasks?.length ? Math.max(...window.__longTasks) : 0,
            longTaskTotalMs: Math.round(window.__ltTotal || 0),
            usedHeapMb: mem,
            bodyTextLength: document.body.innerText.length,
            title: document.title,
            bodyTextHead: document.body.innerText.slice(0, 220).replace(/\s+/g, ' '),
          };
        })
        .catch(() => ({ domNodes: null, cards: null, longTasks: null, longTaskTotalMs: null }));

      page.off('response', onResponse);
      const mcpFetches = mcp.filter((m) => m.bytes >= 0);
      const bytes = mcpFetches.reduce((s, m) => s + m.bytes, 0);
      result.pages[name] = {
        dataLoadedMs,
        domSettledMs,
        firstMcpMs,
        timedOut,
        navError,
        mcpCalls: mcp.length,
        sseResponses: mcp.filter((m) => m.sse).length,
        mcpBytes: bytes,
        largestMcpBytes: mcpFetches.length ? Math.max(...mcpFetches.map((m) => m.bytes || 0)) : 0,
        ...metrics,
      };
      process.stderr.write(
        `  ${name.padEnd(12)} ${String(dataLoadedMs).padStart(7)} ms  mcp=${mcp.length} calls/${(
          bytes / 1048576
        ).toFixed(1)} MB  dom=${metrics.domNodes}  cards=${metrics.cards}  longTasks=${metrics.longTasks}/${metrics.longTaskTotalMs} ms${timedOut ? '  TIMEOUT' : ''}\n`,
      );
      await page.goto('about:blank');
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const text = JSON.stringify(result, null, 2);
  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(path.resolve(args.out), text, 'utf8');
    console.log(`results → ${path.resolve(args.out)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
