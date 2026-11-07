/**
 * cli/bridge.ts — `mcp-task-knowledge bridge` (MU-08).
 *
 * Runs the thin proxy as a stdio server: the MCP client talks to this process,
 * the process talks to the single http core. stdout stays protocol-only; every
 * human-facing line goes to stderr, and the token never appears in either.
 */

import { writeSync } from 'node:fs';
import { StdioBridge } from '../proxy/shim.js';
import { redactUrl, scrubSensitiveText } from '../proxy/bootstrap.js';
import { DEFAULT_PROXY_CONFIG } from '../proxy/types.js';
import type { ProxyConfig } from '../proxy/types.js';

export const BRIDGE_EXIT = {
  OK: 0,
  USAGE: 2,
  UPSTREAM: 3,
  AUTH: 4,
} as const;

const USAGE = `Usage: mcp-task-knowledge bridge --url <http(s)://core/mcp> [--token <token>]

  --url, --proxy-upstream   MCP endpoint of the http core (env: MCP_PROXY_UPSTREAM)
  --token                   access token (env: MCP_PROXY_TOKEN); never printed
  -h, --help                show this help

Exit codes: 0 stdin closed / signal, 2 usage, 3 upstream unreachable, 4 auth failed.
`;

interface BridgeArgs {
  url: string;
  token?: string;
  help?: boolean;
}

const START_ATTEMPTS = 3;
const START_DELAYS_MS = [300, 900];

function parseArgs(argv: string[]): BridgeArgs | string {
  let url: string | undefined;
  let token: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (name: string): string | undefined => {
      if (arg === name) return argv[++i];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      return undefined;
    };

    if (arg === '-h' || arg === '--help') { help = true; continue; }
    const nextUrl = value('--url') ?? value('--proxy-upstream');
    if (nextUrl !== undefined) { url = nextUrl; continue; }
    const nextToken = value('--token');
    if (nextToken !== undefined) { token = nextToken; continue; }
    return `unknown argument: ${arg}`;
  }

  url = url ?? process.env.MCP_PROXY_UPSTREAM;
  token = token ?? process.env.MCP_PROXY_TOKEN;

  if (help) return { url: url ?? '', token, help: true };
  if (!url) return 'missing --url (or MCP_PROXY_UPSTREAM)';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `invalid --url: ${url}`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `unsupported --url protocol: ${parsed.protocol}`;
  }
  if (parsed.username || parsed.password) {
    return 'credentials in the URL are not supported; pass the token via MCP_PROXY_TOKEN';
  }
  return { url, token };
}

function isAuthFailure(text: string): boolean {
  return /authenticat|401|no tools/i.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildConfig(args: BridgeArgs): ProxyConfig {
  return {
    ...DEFAULT_PROXY_CONFIG,
    enabled: true,
    upstream: {
      ...DEFAULT_PROXY_CONFIG.upstream,
      transport: 'http',
      url: args.url,
      timeoutMs: 30_000,
      reconnectDelayMs: 500,
      maxReconnects: 0,
    },
    auth: args.token
      ? { mode: 'static-token', token: args.token }
      : { mode: 'none' },
    downstream: { transport: 'stdio', port: 0, host: '127.0.0.1' },
  };
}

export async function runBridgeCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    process.stderr.write(`bridge: ${parsed}\n${USAGE}`);
    process.exit(BRIDGE_EXIT.USAGE);
  }
  if (parsed.help) {
    process.stderr.write(USAGE);
    process.exit(BRIDGE_EXIT.OK);
  }

  const token = parsed.token;
  const safeUrl = redactUrl(parsed.url);
  const write = (line: string): void => {
    writeSync(2, `bridge: ${scrubSensitiveText(line, token)}\n`);
  };
  const bridge = new StdioBridge(buildConfig(parsed));
  let stopping = false;
  const initialPpid = process.ppid;

  // A dead parent reparents us to whatever subreaper is closest (pid 1 in a
  // container, systemd --user on a desktop), so pid 1 alone is not a signal.
  const parentWatch = setInterval(() => {
    if (process.ppid !== initialPpid) void shutdown(BRIDGE_EXIT.OK, 'parent exited');
  }, 1000);
  parentWatch.unref();

  const shutdown = async (code: number, reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(parentWatch);
    write(reason);
    try {
      await bridge.stop();
    } catch {
      /* already closing */
    }
    process.exit(code);
  };

  process.stdin.once('end', () => void shutdown(BRIDGE_EXIT.OK, 'stdin closed'));
  process.stdin.once('close', () => void shutdown(BRIDGE_EXIT.OK, 'stdin closed'));
  process.once('SIGINT', () => void shutdown(BRIDGE_EXIT.OK, 'SIGINT'));
  process.once('SIGTERM', () => void shutdown(BRIDGE_EXIT.OK, 'SIGTERM'));

  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    try {
      await bridge.start();
      write(`connected to ${safeUrl} — stdio bridge ready`);
      return;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (isAuthFailure(message)) {
        write(`authentication failed: ${message}`);
        await shutdown(BRIDGE_EXIT.AUTH, 'authentication failed');
        return;
      }
      write(`upstream unavailable (attempt ${attempt}/${START_ATTEMPTS}): ${message}`);
      if (attempt === START_ATTEMPTS) {
        await shutdown(BRIDGE_EXIT.UPSTREAM, `upstream unreachable: ${safeUrl}`);
        return;
      }
      await sleep(START_DELAYS_MS[attempt - 1] ?? START_DELAYS_MS[START_DELAYS_MS.length - 1]);
    }
  }
}
