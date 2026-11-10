/**
 * DX-10: `mcp-task-knowledge setup` — интерактивный установщик.
 *
 * Detects known MCP clients by their config paths, asks for transport/DATA_DIR (or accepts
 * `--client X --yes` for CI), merges one `mcp-task-knowledge` entry into `mcpServers` idempotently
 * with a backup, then runs a real stdio self-check (`initialize` → `tools/list`) and the DX-11
 * health gate. The module must not import `config.js` at load: setup itself runs before DATA_DIR
 * is configured; the health module is imported only after DATA_DIR is resolved.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { HealthReport } from './health.js';
import { runHealthGate } from './health.js';

export type ClientKind = 'claude-desktop' | 'cursor' | 'windsurf' | 'vscode' | 'claude-code';

export interface ClientTarget {
  kind: ClientKind;
  file: string;
  /** Top-level key that stores MCP servers in this client's config. */
  serversKey: 'mcpServers' | 'servers';
  exists: boolean;
}

export interface SetupOptions {
  clients?: ClientKind[];
  transport?: 'stdio' | 'http';
  dataDir?: string;
  serverUrl?: string;
  token?: string;
  yes?: boolean;
  /** Skip the stdio self-check (tests/interactive dry runs). Default false. */
  skipSelfCheck?: boolean;
  selfCheckTimeoutMs?: number;
  home?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  spawnFn?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
  healthGate?: (options: { dataDir: string; env: NodeJS.ProcessEnv }) => Promise<HealthReport>;
  /** Test seam for interactive prompts. */
  prompt?: (question: string, defaultValue: string) => Promise<string>;
  write?: (line: string) => void;
}

export interface SetupResult {
  exitCode: number;
  text: string;
  targets: Array<{ kind: ClientKind; file: string; action: 'created' | 'updated' | 'unchanged'; backup?: string }>;
  selfCheck?: { ok: boolean; tools: number; error?: string };
  health?: HealthReport;
}

function configPaths(kind: ClientKind, home: string, appData: string, cwd: string): string {
  switch (kind) {
    case 'claude-desktop':
      return [
        path.join(appData, 'Claude', 'claude_desktop_config.json'),
        path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      ].find((candidate) => fs.existsSync(path.dirname(candidate))) ?? path.join(appData, 'Claude', 'claude_desktop_config.json');
    case 'cursor':
      return path.join(home, '.cursor', 'mcp.json');
    case 'windsurf':
      return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
    case 'vscode':
      return path.join(cwd, '.vscode', 'mcp.json');
    case 'claude-code':
      return path.join(home, '.claude.json');
  }
}

const SERVERS_KEY: Record<ClientKind, 'mcpServers' | 'servers'> = {
  'claude-desktop': 'mcpServers',
  cursor: 'mcpServers',
  windsurf: 'mcpServers',
  vscode: 'servers',
  'claude-code': 'mcpServers',
};

export function detectClients(options: { home?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): ClientTarget[] {
  const env = options.env ?? process.env;
  const home = options.home ?? env.USERPROFILE ?? env.HOME ?? (process.env.HOME || '');
  const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  const cwd = options.cwd ?? process.cwd();
  const kinds: ClientKind[] = ['claude-desktop', 'cursor', 'windsurf', 'vscode', 'claude-code'];
  return kinds.map((kind) => {
    const file = configPaths(kind, home, appData, cwd);
    return { kind, file, serversKey: SERVERS_KEY[kind], exists: fs.existsSync(file) };
  });
}

export function buildServerEntry(options: {
  kind: ClientKind;
  transport: 'stdio' | 'http';
  dataDir: string;
  serverUrl?: string;
  token?: string;
}): Record<string, unknown> {
  if (options.transport === 'http') {
    if (!options.serverUrl) throw new Error('http transport requires --server-url');
    return {
      ...(options.kind === 'vscode' ? { type: 'http' } : {}),
      url: options.serverUrl,
      ...(options.token ? { headers: { Authorization: `Bearer ${options.token}` } } : {}),
    };
  }
  const stdio = {
    command: 'npx',
    args: ['-y', 'mcp-task-knowledge'],
    env: { DATA_DIR: options.dataDir },
    ...(options.kind === 'vscode' ? { type: 'stdio' } : {}),
  };
  return stdio;
}

export interface MergeResult {
  action: 'created' | 'updated' | 'unchanged';
  backup?: string;
  config: Record<string, unknown>;
}

export function mergeClientConfig(
  file: string,
  serversKey: 'mcpServers' | 'servers',
  entry: Record<string, unknown>,
  now: () => Date = () => new Date(),
): MergeResult {
  const exists = fs.existsSync(file);
  let config: Record<string, unknown> = {};
  if (exists) {
    config = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  }
  const servers = (config[serversKey] as Record<string, unknown> | undefined) ?? {};
  const nextServers = { ...servers, 'mcp-task-knowledge': entry };
  const next = { ...config, [serversKey]: nextServers };
  if (JSON.stringify(config) === JSON.stringify(next)) return { action: 'unchanged', config };
  let backup: string | undefined;
  if (exists) {
    backup = `${file}.bak-${now().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return { action: exists ? 'updated' : 'created', backup, config: next };
}

export interface SelfCheckOptions {
  dataDir: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  spawnFn?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
}

export async function runSelfCheck(options: SelfCheckOptions): Promise<{ ok: boolean; tools: number; error?: string }> {
  const command = options.command ?? process.execPath;
  const args = options.args ?? [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js')];
  const spawnFn = options.spawnFn ?? (nodeSpawn as unknown as NonNullable<SelfCheckOptions['spawnFn']>);
  const timeoutMs = options.timeoutMs ?? 20_000;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    let child: ChildProcess;
    const finish = (result: { ok: boolean; tools: number; error?: string }) => {
      if (finished) return;
      finished = true;
      if (result.ok) {
        // Let the probe server exit on EOF so its lock/file handles are released before cleanup.
        try {
          child?.stdin?.end();
        } catch {
          // best-effort
        }
        setTimeout(() => {
          try {
            child?.kill();
          } catch {
            // best-effort
          }
        }, 300);
      } else {
        try {
          child?.kill();
        } catch {
          // best-effort
        }
      }
      resolve(result);
    };
    try {
      child = spawnFn(command, args, {
        env: { ...process.env, DATA_DIR: options.dataDir, MCP_TRANSPORT: 'stdio', EMBEDDINGS_MODE: 'none' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ ok: false, tools: 0, error: (error as Error).message });
      return;
    }
    // A server that exits right after answering makes later stdin writes race the closed pipe;
    // the EPIPE is expected noise, not a failed self-check.
    child.stdin?.on('error', () => undefined);
    const timer = setTimeout(() => finish({ ok: false, tools: 0, error: `self-check timeout after ${timeoutMs}ms` }), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      for (const line of stdout.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const message = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } };
          if (message.id === 1 && message.result) {
            if (child.stdin?.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
            if (child.stdin?.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
          }
          if (message.id === 2 && Array.isArray(message.result?.tools)) {
            clearTimeout(timer);
            finish({ ok: true, tools: message.result.tools.length });
          }
        } catch {
          // ignore non-JSON/log lines
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, tools: 0, error: error.message });
    });
    child.on('exit', (code) => {
      if (finished) return;
      clearTimeout(timer);
      finish({ ok: false, tools: 0, error: `server exited with code ${code ?? 'null'}${stderr ? `: ${stderr.trim()}` : ''}` });
    });
    child.stdin?.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-task-knowledge-setup', version: '1' },
        },
      })}\n`,
    );
  });
}

function parseArgs(args: string[]): {
  clients?: ClientKind[];
  transport?: 'stdio' | 'http';
  dataDir?: string;
  serverUrl?: string;
  token?: string;
  yes: boolean;
  json: boolean;
  skipSelfCheck: boolean;
  help: boolean;
} {
  const options = { yes: false, json: false, skipSelfCheck: false, help: false } as ReturnType<typeof parseArgs> & { help: boolean };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--client') {
      options.clients = (args[++index] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean) as ClientKind[];
    } else if (arg === '--transport') options.transport = args[++index] as 'stdio' | 'http';
    else if (arg === '--data-dir') options.dataDir = args[++index];
    else if (arg === '--server-url') options.serverUrl = args[++index];
    else if (arg === '--token') options.token = args[++index];
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--skip-self-check') options.skipSelfCheck = true;
    else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export const SETUP_USAGE = `Usage: mcp-task-knowledge setup [--client X[,Y]] [--transport stdio|http] [--data-dir PATH]
                              [--server-url URL] [--token TOKEN] [--yes] [--json] [--skip-self-check]

  --client        claude-desktop | cursor | windsurf | vscode | claude-code (repeat/comma)
  --transport     stdio (default) or http
  --data-dir      DATA_DIR written into the client env (default: env DATA_DIR or ./data)
  --server-url    required for http
  --token         optional Authorization bearer token for http
  --yes           non-interactive: accept defaults for missing answers (CI)
  --skip-self-check  skip the stdio initialize/tools/list probe (tests only)
  --json          machine-readable result`;

export async function runSetupCli(args: string[], options: SetupOptions = {}): Promise<SetupResult> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    return { exitCode: 2, text: `setup: ${(error as Error).message}\n\n${SETUP_USAGE}`, targets: [] };
  }
  if (parsed.help) return { exitCode: 0, text: SETUP_USAGE, targets: [] };

  const env = options.env ?? process.env;
  const home = options.home ?? env.USERPROFILE ?? env.HOME ?? '';
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const targets = detectClients({ home, cwd: options.cwd ?? process.cwd(), env });
  const detected = targets.filter((target) => target.exists).map((target) => target.kind);
  const selected = parsed.clients?.filter((kind) => targets.some((target) => target.kind === kind)) ?? [];
  if ((parsed.clients?.length ?? 0) > 0 && selected.length !== parsed.clients!.length) {
    const unknown = parsed.clients!.filter((kind) => !targets.some((target) => target.kind === kind));
    return { exitCode: 2, text: `setup: unknown client(s): ${unknown.join(', ')}`, targets: [] };
  }

  let transport = parsed.transport;
  let dataDir = parsed.dataDir ?? env.DATA_DIR ?? './data';
  let clients = selected.length > 0 ? selected : detected;
  let prompt = options.prompt;
  if (!parsed.yes && !prompt) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    prompt = (question, defaultValue) =>
      new Promise((resolve) =>
        rl.question(`${question} [${defaultValue}]: `, (answer) => resolve(answer.trim() || defaultValue)),
      );
    if (!transport) transport = (await prompt('Transport (stdio/http)', 'stdio')) as 'stdio' | 'http';
    dataDir = await prompt('DATA_DIR written into the client config', dataDir);
    if (clients.length === 0) clients = detected;
    rl.close();
  }
  transport ??= 'stdio';
  if (transport !== 'stdio' && transport !== 'http') {
    return { exitCode: 2, text: `setup: unsupported transport ${transport}`, targets: [] };
  }
  if (transport === 'http' && !parsed.serverUrl) {
    return { exitCode: 2, text: 'setup: --server-url is required for http transport', targets: [] };
  }
  if (clients.length === 0) {
    return {
      exitCode: 2,
      text: `setup: no supported client config found (${targets.map((target) => target.kind).join(', ')}); pass --client`,
      targets: [],
    };
  }

  // Installing points the client at DATA_DIR; create it so the health gate sees a writable dir.
  fs.mkdirSync(dataDir, { recursive: true });
  const result: SetupResult = { exitCode: 0, text: '', targets: [] };
  const lines: string[] = [];
  lines.push(`Detected clients: ${detected.length > 0 ? detected.join(', ') : '(none with an existing config)'}`);
  for (const kind of clients) {
    const target = targets.find((candidate) => candidate.kind === kind)!;
    const entry = buildServerEntry({ kind, transport, dataDir, serverUrl: parsed.serverUrl, token: parsed.token });
    const merge = mergeClientConfig(target.file, target.serversKey, entry, options.now);
    result.targets.push({ kind, file: target.file, action: merge.action, backup: merge.backup });
    lines.push(`${kind}: ${merge.action}${merge.backup ? ` (backup: ${merge.backup})` : ''} → ${target.file}`);
  }

  if (!parsed.skipSelfCheck && options.skipSelfCheck !== true) {
    // The self-check must not leave a .server.lock in the user's chosen DATA_DIR (a second setup
    // run would then refuse to boot its probe server). Probe a throw-away directory and clean it.
    const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-setup-check-'));
    let check: { ok: boolean; tools: number; error?: string };
    try {
      check = await runSelfCheck({ dataDir: checkDir, spawnFn: options.spawnFn, timeoutMs: options.selfCheckTimeoutMs });
    } finally {
      // The probe server releases its lock on EOF; give it a moment before deleting on Windows.
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        fs.rmSync(checkDir, { recursive: true, force: true });
      } catch {
        // A leftover temp probe directory is harmless; do not fail setup over cleanup.
      }
    }
    result.selfCheck = check;
    lines.push(check.ok ? `✓ ${check.tools} tools (stdio self-check passed)` : `✗ self-check failed: ${check.error}`);
    if (!check.ok) result.exitCode = 1;
  }

  if (!options.healthGate) {
    process.env.DATA_DIR = dataDir;
  }
  const health = await (options.healthGate ?? ((opts) => runHealthGate(opts)))({
    dataDir,
    env: { ...env, DATA_DIR: dataDir },
  });
  result.health = health;
  lines.push(`Health: ${health.ok ? 'ok' : 'issues'} — ${health.checks.map((check) => `${check.name}=${check.ok ? 'ok' : check.detail}`).join('; ')}`);
  if (!health.ok) result.exitCode = 1;
  lines.push('Cheatsheet: setup wrote the client entry; restart the client; ask "list my tasks"; DATA_DIR stays where you pointed it.');

  result.text = parsed.json ? JSON.stringify(result, null, 2) : lines.join('\n');
  void write;
  return result;
}
