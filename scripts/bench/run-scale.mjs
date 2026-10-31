#!/usr/bin/env node
/**
 * scripts/bench/run-scale.mjs — end-to-end latency/size benchmark for a seeded DATA_DIR.
 *
 * Spawns a REAL server (dist/index.js) over Streamable HTTP with JWT auth, then calls
 * the MCP tools through the official SDK client — the same path an agent or the Web UI
 * proxy uses. For every operation it records median / p95 latency (3+ reps) and the
 * response payload size in bytes, because payload size is what actually lands in the
 * agent context window and in the browser.
 *
 * NOT part of CI and NOT part of `npm test`. See scripts/bench/README.md.
 *
 * Usage:
 *   node scripts/bench/run-scale.mjs --data /tmp/mcp-scale/data-10000 --n 10000
 *   node scripts/bench/run-scale.mjs --data ... --n 100000 --reps 3 --port 3421 --out /tmp/r.json
 *   node scripts/bench/run-scale.mjs --data ... --n 1000 --only tasks_list,search_knowledge
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ─── args ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    data: '',
    n: 0,
    project: 'bench',
    port: 3420,
    reps: 3,
    out: '',
    only: null,
    callTimeoutMs: 300_000,
    keepServer: false,
    label: '',
    securityStack: '0',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--data': out.data = next(); break;
      case '--n': out.n = Number(next()); break;
      case '--project': out.project = next(); break;
      case '--port': out.port = Number(next()); break;
      case '--reps': out.reps = Number(next()); break;
      case '--out': out.out = next(); break;
      case '--only': out.only = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--timeout': out.callTimeoutMs = Number(next()); break;
      case '--keep-server': out.keepServer = true; break;
      case '--label': out.label = next(); break;
      case '--security-stack': out.securityStack = next(); break;
      case '-h':
      case '--help':
        console.log(
          'usage: node scripts/bench/run-scale.mjs --data <DATA_DIR> --n <count> [--project p] [--port 3420] [--reps 3] [--out file] [--only op1,op2] [--timeout ms] [--keep-server] [--label text]',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.data) throw new Error('--data is required');
  if (!Number.isFinite(out.n) || out.n < 0) throw new Error('--n must be >= 0');
  return out;
}

// ─── helpers ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(port, method, urlPath, body, headers = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          resolve({ status: res.statusCode ?? 0, text, json, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('http timeout')));
    req.end(payload);
  });
}

async function waitForHealth(port, child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})`);
    try {
      const r = await httpJson(port, 'GET', '/healthz', undefined, {}, 1000);
      if (r.status === 200) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

async function rssMb(pid) {
  try {
    const raw = await fs.readFile(`/proc/${pid}/status`, 'utf8');
    const m = raw.match(/VmRSS:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function readSampleIds(dataDir, project) {
  const tasksDir = path.join(dataDir, 'tasks', project);
  const docsDir = path.join(dataDir, 'knowledge', project);
  const pick = async (dir, ext, count) => {
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith(ext));
      if (!files.length) return [];
      const out = [];
      // deterministic spread across the directory listing
      for (let i = 0; i < count; i++) out.push(files[Math.floor((i / count) * files.length)].slice(0, -ext.length));
      return out;
    } catch {
      return [];
    }
  };
  return {
    taskIds: await pick(tasksDir, '.json', 12),
    docIds: await pick(docsDir, '.md', 12),
  };
}

// ─── operations ─────────────────────────────────────────────────────

function buildOps({ taskIds, docIds, hasFacts }) {
  const t = (i) => taskIds[i % Math.max(taskIds.length, 1)];
  const d = (i) => docIds[i % Math.max(docIds.length, 1)];
  const ops = [
    { name: 'tasks_get', tool: 'tasks_get', args: () => ({ id: t(0) }) },
    { name: 'tasks_create', tool: 'tasks_create', args: (i) => ({ title: `bench task ${Date.now()}-${i}`, priority: 'medium', tags: ['bench'] }) },
    { name: 'tasks_update', tool: 'tasks_update', args: (i) => ({ id: t(i + 1), priority: 'high' }) },
    { name: 'tasks_list', tool: 'tasks_list', args: () => ({}) },
    { name: 'tasks_list_filtered_status', tool: 'tasks_list', args: () => ({ status: 'pending' }) },
    { name: 'tasks_list_filtered_tag', tool: 'tasks_list', args: () => ({ tag: 'perf' }) },
    { name: 'tasks_tree', tool: 'tasks_tree', args: () => ({}) },
    { name: 'tasks_dag', tool: 'tasks_dag', args: () => ({}) },
    { name: 'search_tasks', tool: 'search_tasks', args: () => ({ query: 'cursor pagination index', limit: 20 }) },
    { name: 'dashboard_stats', tool: 'dashboard_stats', args: () => ({}) },
    { name: 'briefing', tool: 'briefing', args: () => ({ maxTasks: 10, maxDocs: 5 }) },
    { name: 'knowledge_list', tool: 'knowledge_list', args: () => ({}) },
    { name: 'knowledge_get', tool: 'knowledge_get', args: () => ({ id: d(0) }) },
    { name: 'knowledge_tree', tool: 'knowledge_tree', args: () => ({}) },
    { name: 'search_knowledge', tool: 'search_knowledge', args: () => ({ query: 'cursor pagination storage', limit: 20 }) },
  ];
  if (hasFacts) {
    ops.push({ name: 'memory_temporal_query', tool: 'memory_temporal_query', args: () => ({ limit: 50 }) });
    ops.push({ name: 'memory_temporal_stats', tool: 'memory_temporal_stats', args: () => ({}) });
    // Writes the WHOLE graph file back on every mutation (save() → stringify + atomic rename).
    ops.push({
      name: 'memory_temporal_add',
      tool: 'memory_temporal_add',
      args: (i) => ({ statement: `bench fact ${Date.now()}-${i} about cursor pagination`, category: 'fact' }),
    });
  }
  return ops;
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(args.data);
  const project = args.project;
  const results = {
    ok: true,
    label: args.label || `n=${args.n}`,
    n: args.n,
    project,
    dataDir,
    port: args.port,
    reps: args.reps,
    startedAt: new Date().toISOString(),
    env: {
      node: process.version,
      embeddings: 'none',
      searchCacheTtlMs: Number(process.env.SEARCH_CACHE_TTL_MS ?? 60000),
    },
    coldStartMs: null,
    idleRssMb: null,
    ops: {},
    errors: [],
  };

  const { taskIds, docIds } = await readSampleIds(dataDir, project);
  const hasFacts = await fs
    .access(path.join(dataDir, 'memory', 'temporal-graph.json'))
    .then(() => true)
    .catch(() => false);

  if (!taskIds.length && !docIds.length && !hasFacts) {
    throw new Error(`no seeded data under ${dataDir}`);
  }

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    CURRENT_PROJECT: project,
    MCP_TRANSPORT: 'http',
    MCP_PORT: String(args.port),
    MCP_HOST: '127.0.0.1',
    EMBEDDINGS_MODE: 'none',
    CATALOG_ENABLED: 'false',
    OBSIDIAN_VAULT_ROOT: path.join(dataDir, '.vault'),
    JWT_SECRET: 'bench-secret-not-for-production',
    MCP_LOGIN_USER: 'bench',
    MCP_LOGIN_PASSWORD: 'bench-password',
    TASK_CLAIM_SWEEP_MS: '0',
    // Audit logger appends synchronously on every tool call and the token bucket
    // (60 tokens, burst 100, 1 refill/s) throttles long benchmark loops, so the
    // security stack is off for clean latency numbers. Auth itself is separate
    // (AuthManager) and stays on. Pass --security-stack 1 to measure its overhead.
    SECURITY_STACK: args.securityStack,
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  };

  const t0 = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, 'dist/index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (c) => {
    stderrTail = (stderrTail + c.toString()).slice(-4000);
  });
  child.stdout.on('data', () => {});

  const cleanup = async () => {
    if (args.keepServer) return;
    try { child.kill('SIGTERM'); } catch {}
    await sleep(300);
    try { child.kill('SIGKILL'); } catch {}
  };

  try {
    process.stderr.write(`  server spawned (pid ${child.pid}), waiting for /healthz…\n`);
    const ready = await waitForHealth(args.port, child);
    if (!ready) throw new Error(`server did not become healthy on :${args.port}\n${stderrTail}`);
    results.coldStartMs = Date.now() - t0;
    process.stderr.write(`  cold start (spawn → /healthz 200): ${results.coldStartMs} ms\n`);

    // ── auth: login → JWT → mcp.authenticate on the MCP session
    const login = await httpJson(args.port, 'POST', '/auth/login', {
      username: 'bench',
      password: 'bench-password',
    });
    const token = login.json?.token ?? login.json?.accessToken ?? login.json?.data?.token;
    if (!token) {
      throw new Error(`login failed (${login.status}): ${login.text.slice(0, 300)}`);
    }

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${args.port}/`));
    const client = new Client({ name: 'scale-bench', version: '0.0.1' });
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error('client.connect timeout after 60000 ms')), 60_000)),
    ]);
    process.stderr.write(`  mcp session ${transport.sessionId}\n`);

    const auth = await client.callTool({ name: 'mcp.authenticate', arguments: { token } });
    const authText = auth?.content?.[0]?.text ?? '';
    if (auth?.isError) throw new Error(`mcp.authenticate failed: ${authText.slice(0, 300)}`);

    results.idleRssMb = await rssMb(child.pid);

    const ops = buildOps({ taskIds, docIds, hasFacts }).filter(
      (op) => !args.only || args.only.includes(op.name),
    );

    for (const op of ops) {
      const times = [];
      const sizes = [];
      const errs = [];
      let lastStatus = 'ok';
      for (let rep = 0; rep < args.reps; rep++) {
        const started = Date.now();
        let text = '';
        try {
          const res = await Promise.race([
            // The SDK default request timeout is 60 s; large list ops at 100k exceed it,
            // which would otherwise be reported as a transport error rather than latency.
            client.callTool({ name: op.tool, arguments: op.args(rep) }, undefined, { timeout: args.callTimeoutMs }),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error(`call timeout after ${args.callTimeoutMs} ms`)), args.callTimeoutMs),
            ),
          ]);
          text = res?.content?.[0]?.text ?? '';
          if (res?.isError) {
            lastStatus = 'tool_error';
            errs.push(text.slice(0, 200));
          }
        } catch (err) {
          lastStatus = 'transport_error';
          errs.push(String(err?.message || err).slice(0, 200));
        }
        const elapsed = Date.now() - started;
        times.push(elapsed);
        sizes.push(Buffer.byteLength(text));
        if (lastStatus !== 'ok') {
          // Server death or a hard failure: stop repeating this op.
          if (child.exitCode !== null) break;
        }
      }
      results.ops[op.name] = {
        tool: op.tool,
        status: lastStatus,
        reps: times.length,
        medianMs: median(times),
        p95Ms: percentile(times, 95),
        minMs: times.length ? Math.min(...times) : null,
        maxMs: times.length ? Math.max(...times) : null,
        responseBytes: sizes.length ? Math.max(...sizes) : null,
        allMs: times,
        errors: errs.slice(0, 3),
      };
      if (lastStatus !== 'ok') results.errors.push({ op: op.name, status: lastStatus, sample: errs[0] });
      process.stderr.write(
        `  ${op.name.padEnd(28)} ${String(results.ops[op.name].medianMs).padStart(7)} ms  ` +
          `${(sizes.length ? Math.max(...sizes) : 0 / 1024).toString().padStart(9)} B  ${lastStatus}\n`,
      );
    }

    results.rssAfterLoadMb = await rssMb(child.pid);
    try { await client.close(); } catch {}
  } finally {
    results.serverExitCode = child.exitCode;
    results.serverStderrTail = stderrTail.slice(-1500);
    results.elapsedMs = Date.now() - t0;
    await cleanup();
  }

  const text = JSON.stringify(results, null, 2);
  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(path.resolve(args.out), text, 'utf8');
    console.log(`results → ${path.resolve(args.out)}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: results.errors.length === 0,
        label: results.label,
        n: results.n,
        coldStartMs: results.coldStartMs,
        idleRssMb: results.idleRssMb,
        rssAfterLoadMb: results.rssAfterLoadMb,
        ops: Object.fromEntries(
          Object.entries(results.ops).map(([k, v]) => [
            k,
            { medianMs: v.medianMs, p95Ms: v.p95Ms, bytes: v.responseBytes, status: v.status },
          ]),
        ),
        errors: results.errors,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
