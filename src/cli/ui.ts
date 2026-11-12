/** DX-26d: `ui` starts the HTTP transport and opens it; startup errors get actionable hints. */
import { spawn } from 'node:child_process';

export const UI_USAGE = `Usage: node dist/index.js ui [--port N] [--host H] [--no-open]

  --port N     HTTP port (default: MCP_PORT or 3001)
  --host H     bind host (default: 127.0.0.1)
  --no-open    do not open the browser
`;

export interface UiArgs {
  port: number;
  host: string;
  open: boolean;
  help: boolean;
}

export function parseUiArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): UiArgs | string {
  let port = Number(env.MCP_PORT ?? 3001);
  let host = '127.0.0.1';
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { port, host, open, help: true };
    if (arg === '--port') {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return '--port must be 1..65535';
      continue;
    }
    if (arg === '--host') {
      host = argv[++i] ?? '';
      if (!host) return 'missing value for --host';
      continue;
    }
    if (arg === '--no-open') { open = false; continue; }
    return `unknown argument: ${arg}`;
  }
  return { port, host, open, help: false };
}

export function uiUrl(host: string, port: number): string {
  const display = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${display}:${port}/`;
}

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export function startupHint(error: unknown): string | null {
  const err = error as { code?: string; message?: string };
  if (err?.code === 'EADDRINUSE') return 'port is busy; pass --port N (or set MCP_PORT)';
  if (/DATA_DIR must be set/i.test(err?.message ?? '')) return 'set DATA_DIR to a writable directory';
  if (/EACCES|EPERM/i.test(`${err?.code} ${err?.message}`)) return 'DATA_DIR or the port is not writable; choose another path/port';
  return null;
}

export async function runUiCli(argv: string[]): Promise<number> {
  const parsed = parseUiArgs(argv);
  if (typeof parsed === 'string') {
    process.stderr.write(`ui: ${parsed}\n${UI_USAGE}`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(UI_USAGE);
    return 0;
  }
  try {
    const { AppContainer } = await import('../core/app-container.js');
    const app = new AppContainer({ transportType: 'http', port: parsed.port, host: parsed.host });
    await app.run();
    const url = uiUrl(parsed.host, parsed.port);
    process.stdout.write(`ui: listening on ${url}\n`);
    if (parsed.open) openBrowser(url);
    return 0;
  } catch (error) {
    process.stderr.write(`ui: ${(error as Error).message}\n`);
    const hint = startupHint(error);
    if (hint) process.stderr.write(`hint: ${hint}\n`);
    return 1;
  }
}
