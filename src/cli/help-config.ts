/** DX-26a: help text and effective-config printing without booting the server. */

export const CLI_USAGE = `mcp-task-knowledge — MCP task/knowledge server

Usage:
  node dist/index.js                     start MCP server (stdio by default)
  node dist/index.js doctor [--json]     data-integrity scan
  node dist/index.js bridge --url URL    stdio → HTTP thin proxy
  node dist/index.js reindex [--dry-run] rebuild derived metadata index
  node dist/index.js config show         print effective config (secrets redacted)

Environment:
  DATA_DIR              required storage root
  MCP_TRANSPORT         stdio | http | tcp | unix (default stdio)
  MCP_PORT / MCP_HOST   HTTP/TCP listen address
  EMBEDDINGS_MODE       none | onnx-cpu | onnx-gpu
  LOG_FILE              opt-in JSON log file for logs_tail
`;

type Scrubbing = (text: string) => string;

function redact(value: unknown, scrub: Scrubbing): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry, scrub));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/(token|secret|password|passwd|api[_-]?key|private[_-]?key)/i.test(key)) out[key] = '[REDACTED]';
      else out[key] = redact(entry, scrub);
    }
    return out;
  }
  if (typeof value === 'string') return scrub(value);
  return value;
}

export function runHelp(): void {
  process.stdout.write(CLI_USAGE);
}

/** Loads `config.ts` only when called: `--help` must work without DATA_DIR. */
export async function runConfigShow(): Promise<number> {
  try {
    const { loadConfig } = await import('../config.js');
    const { scrubSensitiveText } = await import('../proxy/bootstrap.js');
    const cfg = loadConfig() as unknown;
    process.stdout.write(`${JSON.stringify(redact(cfg, scrubSensitiveText), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`config show: ${(error as Error).message}\n`);
    process.stderr.write('hint: set DATA_DIR to a writable directory and retry\n');
    return 2;
  }
}
