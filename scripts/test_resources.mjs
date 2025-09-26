#!/usr/bin/env node
// E2E probe for MCP resources via JSON-RPC over stdio (no SDK dependency)
// - Spawns the local server (dist/index.js or npx tsx src/index.ts)
// - Speaks MCP JSON-RPC framing (Content-Length headers)
// - Validates responses and exercises dynamic resource paths

import assert from "node:assert";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function toBase64Url(json) {
  const s = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function ok(v) { return { ok: true, ...v }; }
function fail(v) { return { ok: false, ...v }; }

// --- JSON-RPC over stdio framing helpers (LSP-style) ---
function encodeMessage(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, body]);
}

function createRpcClient(child) {
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map(); // id -> { resolve, reject }

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // parse loop
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        // drop invalid header
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = parseInt(m[1], 10);
      const total = headerEnd + 4 + length;
      if (buffer.length < total) break; // wait for full body
      const body = buffer.slice(headerEnd + 4, total).toString('utf8');
      buffer = buffer.slice(total);
      try {
        const msg = JSON.parse(body);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // ignore parse errors
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    // Optional: log to console for diagnostics
    // process.stderr.write(chunk);
  });

  function call(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const buf = encodeMessage(payload);
    child.stdin.write(buf);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // optional timeout
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`RPC timeout for ${method}`));
        }
      }, 60000);
    });
  }

  return { call };
}

async function main() {
  const startTs = Date.now();
  // Prefer compiled server if dist is readable; otherwise fallback to tsx runner
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const distEntry = path.join(repoRoot, "dist", "index.js");
  let command = "node";
  let args = ["dist/index.js"];
  try { fs.accessSync(distEntry, fs.constants.R_OK); }
  catch {
    const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    try { fs.accessSync(tsxCli, fs.constants.R_OK); args = [tsxCli, 'src/index.ts']; }
    catch { throw new Error('Neither dist/index.js nor local tsx CLI found. Run: npm run build or install dev deps.'); }
  }

  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // Minimal data layout expected by server
      DATA_DIR: process.env.DATA_DIR || path.join(repoRoot, '.data'),
      OBSIDIAN_VAULT_ROOT: process.env.OBSIDIAN_VAULT_ROOT || path.join(repoRoot, '.data', 'obsidian'),
      EMBEDDINGS_MODE: process.env.EMBEDDINGS_MODE || "none",
      STARTUP_SILENT: process.env.STARTUP_SILENT || "1",
      LOG_STARTUP: process.env.LOG_STARTUP || "0",
      MCP_TOOLS_ENABLED: process.env.MCP_TOOLS_ENABLED || "true",
      MCP_TOOL_RESOURCES_ENABLED: process.env.MCP_TOOL_RESOURCES_ENABLED || "true",
      MCP_TOOL_RESOURCES_EXEC: process.env.MCP_TOOL_RESOURCES_EXEC || "true",
    },
  });
  const client = createRpcClient(child);
  // Ensure required directories exist before server starts reading them
  try {
    const dataDir = process.env.DATA_DIR || path.join(repoRoot, '.data');
    const vaultDir = process.env.OBSIDIAN_VAULT_ROOT || path.join(repoRoot, '.data', 'obsidian');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(vaultDir, { recursive: true });
  } catch {}
  let childExited = false;
  child.on('error', (e) => {
    console.error('[resources-probe] child process error', e);
  });
  child.on('exit', (code, signal) => {
    childExited = true;
    console.error(`[resources-probe] child exited code=${code} signal=${signal}`);
  });

  // Minimal MCP initialize (with small delay and clientInfo)
  await new Promise((r) => setTimeout(r, 300));
  try {
    const init = await client.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'resources-probe', version: '1.0.0' },
    });
    assert(init.result !== undefined || init.error === undefined, 'initialize failed');
  } catch (e) {
    console.error('[resources-probe] initialize failed:', e?.message || String(e));
    // Best-effort nudge: try one resources/list to wake connection, then continue
    try { await client.call('resources/list', {}); } catch {}
  }

  const results = [];
  const add = (r) => results.push(r);

  // Helper: read a resource and validate basic structure
  async function readAndValidate(uri, { parseJson = true } = {}) {
    try {
      const res = await client.call('resources/read', { uri });
      const payload = res.result || res; // support direct result
      assert(payload && payload.contents && Array.isArray(payload.contents) && payload.contents.length >= 1, `Bad contents for ${uri}`);
      const first = payload.contents[0];
      assert(first.uri && typeof first.text === 'string', `Bad envelope for ${uri}`);
      if (parseJson) {
        const parsed = fromJson(first.text);
        assert(parsed !== null, `JSON parse failed for ${uri}`);
      }
      add(ok({ uri }));
    } catch (e) {
      add(fail({ uri, error: e?.message || String(e) }));
    }
  }

  // 1) List all resources
  let resourcesList = [];
  try {
    const listed = await client.call('resources/list', {});
    const payload = listed.result || listed;
    assert(Array.isArray(payload.resources));
    resourcesList = payload.resources.map((r) => r.uri);
    add(ok({ uri: 'resources/list', count: payload.resources.length }));
  } catch (e) {
    add(fail({ uri: 'resources/list', error: e?.message || String(e) }));
  }

  // 2) Project basics
  await readAndValidate('project://projects');
  await readAndValidate('project://current');

  // Figure out some project ids
  let projectIds = [];
  try {
    const res = await client.call('resources/read', { uri: 'project://projects' });
    const parsed = fromJson((res.result || res).contents[0].text);
    projectIds = (parsed?.projects || []).map((p) => String(p.id));
  } catch {}
  if (projectIds.length === 0) projectIds = ['mcp'];

  // Switch to each project and validate current
  for (const pid of projectIds) {
    await readAndValidate(`project://use/${encodeURIComponent(pid)}`);
    await readAndValidate('project://current');
  }

  // project://refresh removed in templated mode; no-op

  // 3) Tasks resources
  await readAndValidate('task://tasks');
  for (const pid of projectIds) {
    await readAndValidate(`tasks://project/${encodeURIComponent(pid)}`);
    await readAndValidate(`tasks://project/${encodeURIComponent(pid)}/tree`);
    for (const st of ['pending','in_progress','completed','closed']) {
      await readAndValidate(`tasks://project/${encodeURIComponent(pid)}/status/${st}`);
    }
    // Try tag filter with a likely-nonexistent tag (should return [])
    await readAndValidate(`tasks://project/${encodeURIComponent(pid)}/tag/example`);
  }
  await readAndValidate('tasks://current');
  await readAndValidate('tasks://current/tree');

  // Pick a task for actions (if any)
  let anyTask = null;
  try {
    const res = await client.call('resources/read', { uri: `tasks://project/${encodeURIComponent(projectIds[0])}` });
    const arr = fromJson((res.result || res).contents[0].text) || [];
    if (Array.isArray(arr) && arr.length) anyTask = { project: arr[0].project || projectIds[0], id: arr[0].id };
  } catch {}

  if (anyTask) {
    const { project, id } = anyTask;
    for (const action of ['start','complete','close','trash','restore','archive']) {
      await readAndValidate(`task://action/${encodeURIComponent(project)}/${encodeURIComponent(id)}/${action}`);
    }
  }

  // 4) Knowledge resources
  await readAndValidate('knowledge://docs');
  for (const pid of projectIds) {
    await readAndValidate(`knowledge://project/${encodeURIComponent(pid)}`);
    await readAndValidate(`knowledge://project/${encodeURIComponent(pid)}/tree`);
    await readAndValidate(`knowledge://project/${encodeURIComponent(pid)}/tag/example`);
    await readAndValidate(`knowledge://project/${encodeURIComponent(pid)}/type/note`);
  }
  await readAndValidate('knowledge://current');
  await readAndValidate('knowledge://current/tree');

  // 5) Prompt resources basics (catalog)
  await readAndValidate('prompt://catalog');

  // 6) Export resources basics (files)
  await readAndValidate('export://files');

  // 7) Tool resources (only if wrappers are registered)
  if (resourcesList.includes('tool://catalog')) {
    await readAndValidate('tool://catalog');
    await readAndValidate('tool://schema/tools_list');
    await readAndValidate('tool://tools_list');
  } else {
    add(ok({ uri: 'tool://catalog', skipped: true }));
  }

  // 8) Search resources
  const b64Tasks = toBase64Url({ query: 'example', limit: 5 });
  await readAndValidate(`search://tasks/${encodeURIComponent(projectIds[0])}/recent`);
  await readAndValidate(`search://tasks/${encodeURIComponent(projectIds[0])}/${b64Tasks}`);
  // url-encoded JSON params
  const urlEncTasks = encodeURIComponent(JSON.stringify({ query: 'hello', limit: 3 }));
  await readAndValidate(`search://tasks/${encodeURIComponent(projectIds[0])}/${urlEncTasks}`);

  const b64Know = toBase64Url({ query: 'example', limit: 5 });
  await readAndValidate(`search://knowledge/${encodeURIComponent(projectIds[0])}/recent`);
  await readAndValidate(`search://knowledge/${encodeURIComponent(projectIds[0])}/${b64Know}`);
  const urlEncKnow = encodeURIComponent(JSON.stringify({ query: 'hello', limit: 3 }));
  await readAndValidate(`search://knowledge/${encodeURIComponent(projectIds[0])}/${urlEncKnow}`);

  // 9) Verify reading concrete task/knowledge resource if available
  if (anyTask) {
    const { project, id } = anyTask;
    await readAndValidate(`task://${encodeURIComponent(project)}/${encodeURIComponent(id)}`);
  }
  // Try reading a knowledge doc if any exists
  try {
    const res = await client.call('resources/read', { uri: `knowledge://project/${encodeURIComponent(projectIds[0])}` });
    const arr = fromJson((res.result || res).contents[0].text) || [];
    if (Array.isArray(arr) && arr.length) {
      await readAndValidate(`knowledge://${encodeURIComponent(arr[0].project || projectIds[0])}/${encodeURIComponent(arr[0].id)}`);
    }
  } catch {}

  // Prepare report
  const elapsed = Date.now() - startTs;
  const failures = results.filter(r => !r.ok);
  const passes = results.filter(r => r.ok);

  // Print machine summary first
  const summary = {
    total: results.length,
    passes: passes.length,
    failures: failures.length,
    elapsedMs: elapsed,
  };
  console.log(JSON.stringify({ kind: 'resources-probe-summary', summary, results }, null, 2));

  // Exit non-zero if failures present
  if (failures.length > 0) {
    console.error(`\n[resources-probe] FAILURES: ${failures.length}`);
    failures.forEach(f => console.error(` - ${f.uri}: ${f.error}`));
    try { child.kill(); } catch {}
    process.exit(2);
  }
  try { child.kill(); } catch {}
}

main().catch((e) => {
  console.error('[resources-probe] fatal error', e);
  process.exit(1);
});
