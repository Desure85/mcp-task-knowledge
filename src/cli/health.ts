/**
 * DX-11: runtime health gate for `doctor` (and, later, the end of `setup`).
 *
 * The checks are injectable so tests do not depend on the host Node version, a free port or real
 * client configuration. Every failing check carries an explicit level and detail: a missing client
 * config is a warning (MCP clients are optional), while a busy port or an invalid config is an error.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { reloadFileConfig } from '../config.js';

export type HealthLevel = 'error' | 'warn';

export interface HealthCheck {
  name: 'node' | 'data-dir' | 'config' | 'port' | 'clients';
  level: HealthLevel;
  ok: boolean;
  detail: string;
}

export interface HealthReport {
  checks: HealthCheck[];
  ok: boolean;
}

export interface HealthOptions {
  nodeVersion?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  reloadConfig?: () => { ok: boolean; error?: string; source: string };
  /** Explicit client config paths; defaults to the known Claude Desktop/Cursor locations. */
  clientConfigPaths?: string[];
  /** Force the port check (by default it runs for the http transport or explicit MCP_PORT). */
  checkPort?: boolean;
  port?: number;
}

export function defaultClientConfigPaths(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? os.homedir();
  const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  const paths = new Set<string>([
    // Claude Desktop
    path.join(appData, 'Claude', 'claude_desktop_config.json'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
    // Cursor / generic MCP configs
    path.join(home, '.cursor', 'mcp.json'),
    path.join(cwd, '.mcp.json'),
  ]);
  return [...paths];
}

function majorVersion(version: string): number {
  const match = /^(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : NaN;
}

function commandLooksAlive(entry: Record<string, unknown>): { ok: boolean; detail: string } {
  const command = typeof entry.command === 'string' ? entry.command : undefined;
  if (!command) {
    if (typeof entry.url === 'string') return { ok: true, detail: `url ${entry.url} (liveness not checked offline)` };
    return { ok: false, detail: 'mcpServers entry has neither command nor url' };
  }
  if (command === 'npx' || command === 'uvx' || command === 'node' || command === 'bun') {
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const script = args.find((arg) => arg.endsWith('.js') || arg.endsWith('.mjs') || arg.endsWith('.cjs'));
    if (!script) {
      const packageArg = args.find((arg) => !arg.startsWith('-'));
      return packageArg
        ? { ok: true, detail: `${command} ${packageArg} (package resolved at runtime)` }
        : { ok: false, detail: `${command} without a package/script argument` };
    }
    return fs.existsSync(script)
      ? { ok: true, detail: `${command} ${script}` }
      : { ok: false, detail: `script does not exist: ${script}` };
  }
  if (path.isAbsolute(command) || command.includes(path.sep) || command.includes('/')) {
    return fs.existsSync(command) ? { ok: true, detail: command } : { ok: false, detail: `binary does not exist: ${command}` };
  }
  return { ok: true, detail: `command ${command} (resolved via PATH at runtime)` };
}

export function inspectClientConfigs(paths: string[]): HealthCheck {
  const existing: Array<{ file: string; entries: number; broken: string[] }> = [];
  for (const file of paths) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers?: Record<string, Record<string, unknown>> };
      const servers = parsed.mcpServers ?? {};
      const relevant = Object.entries(servers).filter(
        ([name, entry]) =>
          // Only entries that look like this server; other MCP servers are not our business.
          name.includes('mcp-task-knowledge') ||
          JSON.stringify(entry).includes('mcp-task-knowledge'),
      );
      const broken = relevant
        .map(([name, entry]) => {
          const result = commandLooksAlive(entry);
          return result.ok ? null : `${name}: ${result.detail}`;
        })
        .filter((value): value is string => value !== null);
      existing.push({ file, entries: relevant.length, broken });
    } catch (error) {
      existing.push({ file, entries: 0, broken: [`unreadable config: ${(error as Error).message}`] });
    }
  }
  if (existing.length === 0) {
    // An absent client config is informational, not an issue: MCP clients are optional and the
    // server can be installed before the client is configured. `doctor` must not fail healthy trees.
    return { name: 'clients', level: 'warn', ok: true, detail: `no client config found (searched ${paths.length} paths)` };
  }
  const broken = existing.flatMap((entry) => entry.broken);
  if (broken.length > 0) {
    return { name: 'clients', level: 'warn', ok: false, detail: broken.join('; ') };
  }
  const entries = existing.reduce((sum, entry) => sum + entry.entries, 0);
  return {
    name: 'clients',
    level: 'warn',
    ok: true,
    detail: entries === 0 ? `${existing.length} config(s), no mcp-task-knowledge entry` : `${entries} live mcp-task-knowledge entry(ies)`,
  };
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export async function runHealthGate(options: HealthOptions = {}): Promise<HealthReport> {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? env.DATA_DIR ?? process.cwd();
  const checks: HealthCheck[] = [];

  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const major = majorVersion(nodeVersion);
  checks.push(
    Number.isFinite(major) && major >= 20
      ? { name: 'node', level: 'error', ok: true, detail: `Node ${nodeVersion}` }
      : { name: 'node', level: 'error', ok: false, detail: `Node ${nodeVersion} < 20` },
  );

  let dataOk = fs.existsSync(dataDir);
  let dataDetail = dataDir;
  if (dataOk) {
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
    } catch {
      dataOk = false;
      dataDetail = `${dataDir} is not writable`;
    }
  } else {
    dataDetail = `${dataDir} does not exist`;
  }
  checks.push({ name: 'data-dir', level: 'error', ok: dataOk, detail: dataDetail });

  const config = (options.reloadConfig ?? reloadFileConfig)();
  // No file config is a valid setup (env/defaults are the primary path); only a present-but-broken
  // config is an error.
  const configOk = config.ok || config.source === 'none';
  checks.push({
    name: 'config',
    level: 'error',
    ok: configOk,
    detail: config.ok
      ? `config valid (${config.source})`
      : configOk
        ? 'no file config — defaults/env apply'
        : `config invalid: ${config.error ?? config.source}`,
  });

  const transport = (env.MCP_TRANSPORT ?? '').trim().toLowerCase();
  const shouldCheckPort = options.checkPort ?? (transport === 'http' || Boolean(env.MCP_PORT));
  if (shouldCheckPort) {
    const port = options.port ?? Number(env.MCP_PORT ?? 3001);
    const free = Number.isFinite(port) ? await portFree(port) : false;
    checks.push({
      name: 'port',
      level: 'error',
      ok: free,
      detail: Number.isFinite(port) ? `port ${port} ${free ? 'free' : 'busy'}` : `invalid MCP_PORT: ${env.MCP_PORT}`,
    });
  } else {
    checks.push({ name: 'port', level: 'warn', ok: true, detail: 'not applicable (stdio transport, MCP_PORT unset)' });
  }

  checks.push(inspectClientConfigs(options.clientConfigPaths ?? defaultClientConfigPaths(env, options.cwd)));

  return { checks, ok: checks.every((check) => check.ok || check.level === 'warn') };
}
