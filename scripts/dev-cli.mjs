#!/usr/bin/env node
// scripts/dev-cli.mjs — Dev CLI for mcp-task-knowledge (DX-003)
//
// Usage:
//   node scripts/dev-cli.mjs diagnose          — config validation + health
//   node scripts/dev-cli.mjs tools             — list registered tools
//   node scripts/dev-cli.mjs sessions          — active sessions (HTTP transport)
//   node scripts/dev-cli.mjs restore <archive>  — restore DATA_DIR from a tar.gz (ADR-008)
//
// Each command boots the real server via stdio and calls the corresponding
// MCP tools (tools_list, health, project_list, etc.).

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Таймаут запроса к MCP (SDK по умолчанию 60 с — мало для list на больших данных). */
const MCP_TIMEOUT_MS = Number(process.env.MCP_REQUEST_TIMEOUT_MS) > 0 ? Number(process.env.MCP_REQUEST_TIMEOUT_MS) : 120_000;

const ROOT = resolve(process.cwd());

function usage() {
  console.log(`Dev CLI for mcp-task-knowledge (DX-003)

Usage:
  node scripts/dev-cli.mjs diagnose              — config + health check
  node scripts/dev-cli.mjs tools                 — list registered tools
  node scripts/dev-cli.mjs sessions              — active sessions
  node scripts/dev-cli.mjs backup [--out DIR] [--label S] [--include-secrets] [--exclude-models]
                                     — portable tar.gz archive of DATA_DIR (ADR-008)
  node scripts/dev-cli.mjs restore <archive> [--dry-run] [--confirm TOKEN] [--yes]
                                     [--no-prune] [--include-secrets]
                                     — restore DATA_DIR from an archive (dry-run by default)
  node scripts/dev-cli.mjs benchmark [--suite S] [--out FILE] [--project P]
                                     [--data-dir DIR] [--keep-data] [--url HTTP_URL]
                                       — run memory benchmarks (LOCOMO/LongMemEval/BEAM/DMR)
                                         against a real instance, markdown report to stdout + file
`);
}

async function withServer(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'devcli-'));
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      OBSIDIAN_VAULT_ROOT: join(dataDir, 'vault'),
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
    },
  });
  const client = new Client({ name: 'dev-cli', version: '0.0.1' });
  await client.connect(transport);
  try {
    await fn(client);
  } finally {
    await client.close();
    transport.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function call(client, name, args = {}) {
  // SDK default request timeout is 60 s; list ops on large projects legitimately run longer.
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: MCP_TIMEOUT_MS });
  const text = res?.content?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

async function cmdDiagnose() {
  await withServer(async (client) => {
    console.log('=== Diagnose ===');
    // Config validation
    const config = await call(client, 'embeddings_status');
    console.log(`embeddings: ${JSON.stringify(config.data ?? config)}`);
    // Health via app container state (tools_list proves server is up)
    const tools = await call(client, 'tools_list', { offset: 0, limit: 1 });
    console.log(`tools total: ${tools.data?.pagination?.total ?? '?'}`);
    console.log('diagnose: OK — server boots, tools respond');
  });
}

async function cmdTools() {
  await withServer(async (client) => {
    // Page through the whole catalog — a single capped call silently hid tools past the first 100.
    const PAGE = 100;
    const tools = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await call(client, 'tools_list', { offset, limit: PAGE });
      const page = res.data?.data ?? [];
      tools.push(...page);
      const total = res.data?.pagination?.total ?? 0;
      if (page.length < PAGE || tools.length >= total) break;
    }
    console.log(`=== Tools (${tools.length}) ===`);
    for (const t of tools.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${t.name} — ${(t.description ?? '').split('\n')[0].slice(0, 80)}`);
    }
  });
}

async function cmdSessions() {
  await withServer(async (client) => {
    const res = await call(client, 'tools_list', { offset: 0, limit: 1 });
    console.log('=== Sessions ===');
    console.log('Active sessions are only tracked on multi-client (HTTP/TCP) transports.');
    console.log(`Server is ${process.env.MCP_TRANSPORT || 'stdio'} — session tracking ${process.env.MCP_TRANSPORT && process.env.MCP_TRANSPORT !== 'stdio' ? 'active' : 'n/a (stdio = single client)'}.`);
    console.log(`tools total: ${res.data?.pagination?.total ?? '?'}`);
  });
}

async function cmdBackup(rest) {
  const out = flagValue(rest, '--out', undefined);
  const label = flagValue(rest, '--label', undefined);
  const includeSecrets = hasFlag(rest, '--include-secrets');
  const excludeModels = hasFlag(rest, '--exclude-models');
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.error('DATA_DIR is required: the CLI archives the real directory, it must not substitute a temp one');
    process.exit(2);
  }
  const moduleUrl = new URL('../dist/services/backup-archive.js', import.meta.url).href;
  let createBackupArchive;
  try {
    ({ createBackupArchive } = await import(moduleUrl));
  } catch (e) {
    console.error(`Cannot load ${moduleUrl}: ${e?.message ?? e}`);
    console.error('Run `npm run build` first.');
    process.exit(1);
  }
  try {
    const r = await createBackupArchive({ dataDir, out, label, includeSecrets, excludeModels });
    console.log(`Archive: ${r.archivePath}`);
    console.log(`Files: ${r.files}, size: ${r.bytes} bytes`);
    console.log(`Manifest: formatVersion=${r.manifest.formatVersion} profile=${r.manifest.profile} schemaVersion=${r.manifest.schemaVersion}`);
    console.log(`Excluded: ${r.manifest.excluded.join(', ')}`);
    if (r.manifest.containsSecrets) console.log('WARNING: archive contains secrets (.jwt-revoked.json, auth.db)');
  } catch (e) {
    if (e?.code && e?.message) {
      console.error(`${e.code}: ${e.message}`);
      if (e.hint) console.error(`Hint: ${e.hint}`);
    } else {
      console.error(e?.stack || String(e));
    }
    process.exit(1);
  }
}

async function cmdRestore(rest) {
  const archive = rest.find((arg) => !arg.startsWith('--') && arg !== '');
  const dataDir = process.env.DATA_DIR;
  if (!archive) {
    console.error('restore: archive path is required');
    process.exit(2);
  }
  if (!dataDir) {
    console.error('DATA_DIR is required: the CLI restores the real directory, it must not substitute a temp one');
    process.exit(2);
  }
  const confirmAt = rest.indexOf('--confirm');
  const confirm = confirmAt >= 0 ? rest[confirmAt + 1] : undefined;
  if (confirmAt >= 0 && (!confirm || confirm.startsWith('--'))) {
    console.error('restore: --confirm requires the applyToken printed by a dry run');
    process.exit(2);
  }
  const yes = hasFlag(rest, '--yes');
  const includeSecrets = hasFlag(rest, '--include-secrets');
  const prune = !hasFlag(rest, '--no-prune');
  const dryRun = hasFlag(rest, '--dry-run') || (!confirm && !yes);

  let restoreArchive;
  try {
    ({ restoreArchive } = await import(new URL('../dist/services/data-backup.js', import.meta.url).href));
  } catch (e) {
    console.error(`Cannot load dist/services/data-backup.js: ${e?.message ?? e}`);
    console.error('Run `npm run build` first.');
    process.exit(1);
  }

  try {
    if (yes && !confirm) {
      const plan = await restoreArchive({ archive, dataDir, dryRun: true, prune, includeSecrets });
      const applied = await restoreArchive({
        archive,
        dataDir,
        dryRun: false,
        confirm: plan.applyToken,
        prune,
        includeSecrets,
      });
      printRestore(applied);
      return;
    }
    const result = await restoreArchive({ archive, dataDir, dryRun, confirm, prune, includeSecrets });
    printRestore(result);
    if (result.dryRun) {
      console.log(`Apply token: ${result.applyToken}`);
      console.log('Nothing was changed. Re-run with --confirm <token> to apply.');
    }
  } catch (e) {
    if (e?.code && e?.message) {
      console.error(`${e.code}: ${e.message}`);
      if (e.hint) console.error(`Hint: ${e.hint}`);
    } else if (e?.message) {
      console.error(e.message);
      if (e.rolledBack === true) console.error('Rolled back from the pre-restore snapshot.');
    } else {
      console.error(e?.stack || String(e));
    }
    process.exit(1);
  }
}

function printRestore(result) {
  console.log(`Archive: ${result.archivePath}`);
  console.log(`DATA_DIR: ${result.dataDir}`);
  console.log(
    `Manifest: formatVersion=${result.manifest.formatVersion} profile=${result.manifest.profile} ` +
      `schemaVersion=${result.manifest.schemaVersion} containsSecrets=${result.manifest.containsSecrets}`,
  );
  console.log(
    `Plan: ${result.creates.length} create, ${result.overwrites.length} overwrite, ` +
      `${result.deletes.length} delete, ${result.entries} archive entries`,
  );
  for (const item of [...result.deletes].slice(0, 20)) console.log(`  delete ${item.path}`);
  if (result.warnings.length > 0) console.log(`Warnings: ${result.warnings.join('; ')}`);
  if (!result.dryRun) {
    console.log(`Restored files: ${result.filesRestored ?? 0}`);
    console.log(`Pre-restore snapshot: ${result.snapshotDir ?? 'none (DATA_DIR was empty)'}`);
  }
}

function flagValue(args, name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

function hasFlag(args, name) {
  return args.includes(name);
}

// ─── benchmark (NEXT2-007) ───────────────────────────────────────────────────
// Runs the memory benchmark harness (LOCOMO/LongMemEval/BEAM/DMR) against a
// REAL server instance and writes a markdown report to stdout + file.
//
// Default (hermetic): spawns `dist/index.js` over stdio with an ephemeral
// tmp DATA_DIR (same pattern as withServer above). Requires `npm run build`.
// Connect mode: `--url <http-url>` calls an already-running instance instead
// (no spawn, no cleanup). Full run = 20 questions / ~60 MCP calls, <2 min.
async function cmdBenchmark(args) {
  const suiteSpec = flagValue(args, '--suite', 'all');
  const project = flagValue(args, '--project', 'benchmark');
  const url = flagValue(args, '--url', undefined);
  const dataDirArg = flagValue(args, '--data-dir', undefined);
  const keepData = hasFlag(args, '--keep-data') || Boolean(dataDirArg);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
  const outFile = resolve(ROOT, flagValue(args, '--out', `benchmarks/report-${stamp}.md`));

  // dist modules (built from src/memory/*.ts) — fail fast with a hint.
  let suites, runBenchmark, formatReportMarkdown, MCPMemoryAdapter;
  try {
    ({ selectSuites: suites } = await import('../dist/memory/mcp-benchmark-adapter.js'));
    ({ runBenchmark, formatReportMarkdown } = await import('../dist/memory/benchmarks.js'));
    ({ MCPMemoryAdapter } = await import('../dist/memory/mcp-benchmark-adapter.js'));
  } catch {
    console.error('benchmark: dist/ modules missing — run `npm run build` first.');
    process.exit(2);
  }
  let selected;
  try {
    selected = suites(suiteSpec);
  } catch (e) {
    console.error(`benchmark: ${e.message}`);
    process.exit(2);
  }

  const startedAt = Date.now();
  let transport;
  let dataDir;
  let mode;
  if (url) {
    mode = `http-connect (${url})`;
    transport = new StreamableHTTPClientTransport(new URL(url));
  } else {
    dataDir = dataDirArg ?? mkdtempSync(join(tmpdir(), 'bench-'));
    mode = `stdio-spawn (DATA_DIR=${dataDir}${dataDirArg ? ', kept' : ''})`;
    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        OBSIDIAN_VAULT_ROOT: join(dataDir, 'vault'),
        EMBEDDINGS_MODE: 'none',
        CATALOG_ENABLED: 'false',
      },
    });
  }

  const client = new Client({ name: 'dev-cli-benchmark', version: '0.0.1' });
  await client.connect(transport);
  // SDK Client exposes callTool directly; adapt to the benchmark client surface.
  const adapter = new MCPMemoryAdapter(
    { callTool: (a) => client.callTool(a, undefined, { timeout: MCP_TIMEOUT_MS }) },
    { baseProject: project },
  );
  const reports = [];
  try {
    for (const suite of selected) {
      const t0 = Date.now();
      reports.push(await runBenchmark(suite, adapter));
      console.log(`  ${suite.name}: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  } finally {
    await client.close().catch(() => {});
    transport.close?.();
    if (dataDir && !keepData) rmSync(dataDir, { recursive: true, force: true });
  }
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);

  const header = [
    '# Benchmark Report',
    '',
    `- **Date:** ${new Date().toISOString()}`,
    `- **Suites:** ${selected.map((s) => s.name).join(', ')}`,
    `- **Adapter:** ${adapter.name} (project base \`${project}\`)`,
    `- **Instance:** ${mode}`,
    `- **Embeddings:** ${process.env.EMBEDDINGS_MODE ?? 'none'} (BM25 path)`,
    `- **Duration:** ${durationS}s`,
    '',
  ].join('\n');
  const md = `${header}${formatReportMarkdown(reports)}\n`;

  mkdirSync(join(outFile, '..'), { recursive: true });
  writeFileSync(outFile, md);
  console.log(`\nBenchmark: ${reports.length} suite(s), ${reports.reduce((n, r) => n + r.totalQuestions, 0)} questions in ${durationS}s → ${outFile}`);
  console.log('\n' + md);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'diagnose': await cmdDiagnose(); break;
  case 'tools': await cmdTools(); break;
  case 'sessions': await cmdSessions(); break;
  case 'benchmark': await cmdBenchmark(rest); break;
  case 'backup': await cmdBackup(rest); break;
  case 'restore': await cmdRestore(rest); break;
  default: usage(); process.exit(cmd ? 1 : 0);
}
