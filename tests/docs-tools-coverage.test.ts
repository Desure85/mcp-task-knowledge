/**
 * P-20261107-9: documentation ↔ live tool surface contract.
 *
 * The previous generation of guards scanned `src/index.ts` for `registerTool(`
 * (zero matches since TD-001) or counted registration lines with a single-line
 * regex. Registration calls in `src/register/*.ts` are multi-line
 * (`server.registerTool(\n  "name",`), and the count depends on feature flags,
 * so both static styles were blind to reality.
 *
 * This file checks the surface a client actually sees:
 *   `createServerContext()`     builds the real `McpServer`
 *   `defaultRegistration(ctx)`  wires every `register*Tools` module
 *   `McpServer.prototype.registerTool` is spied on BEFORE the context exists, so
 *   the spy is the `orig` that src/register/setup.ts wraps and calls. In compact
 *   mode (`MCP_TOOLS_ENABLED=false`) the wrapper skips non-whitelisted tools,
 *   which means only real protocol registrations reach the spy (4 tools), not the
 *   full 128-entry registry that `tools_list` still reports.
 *
 * Counting contract (measured on the base commit, see the decision record):
 *   128 tools by default
 *   130 with `CATALOG_ENABLED=true` (generator env, two dynamic `service_catalog_*`)
 *   132 with `CATALOG_WRITE_ENABLED=true` as well (upsert/delete appear)
 *   4   on the wire in compact mode
 *
 * `docs/api-reference.md` is generated with `CATALOG_ENABLED=true`, so its
 * header must agree with the catalog-mode registration set.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TOOLS_DOC = path.join(ROOT, 'docs', 'features', 'tools.md');
const API_REF = path.join(ROOT, 'docs', 'api-reference.md');

const COMPACT_WHITELIST = ['tool_help', 'tool_schema', 'tools_list', 'tools_run'];

interface Registration {
  name: string;
}

interface Surface {
  names: string[];
  server?: { close: () => Promise<void> };
  tmp: string;
}

/** Rows of a markdown table look like `| \`tool_name\` | description |`. */
function parseDocToolRows(markdown: string): { rows: Set<string>; wildcards: string[] } {
  const rows = new Set<string>();
  const re = /^\|\s*`([^`]+)`/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) rows.add(m[1]);
  return { rows, wildcards: [...rows].filter((r) => r.includes('*')) };
}

/**
 * A tool is documented only by a table row: a bare prose mention ("`briefing`
 * is an aggregation") is not a description and must not satisfy the contract.
 * Wildcard rows (`github_*`) cover a whole connector family.
 */
function isDocumented(name: string, rows: Set<string>, wildcards: string[]): boolean {
  if (rows.has(name)) return true;
  return wildcards.some((w) => {
    const prefix = w.replace(/\*+$/, '');
    return prefix.length > 0 && name.startsWith(prefix);
  });
}

async function collectSurface(tag: string, env: Record<string, string>): Promise<Surface> {
  const tmp = path.join(os.tmpdir(), `docs-tools-${tag}-${process.pid}-${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  process.env.DATA_DIR = tmp;
  process.env.EMBEDDINGS_MODE = 'none';
  process.env.EMBEDDINGS_WARMUP = '0';
  process.env.SECURITY_STACK = '0';
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  // config.ts resolves flags at module load, so the module graph is reset between modes.
  vi.resetModules();
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const spy = vi.spyOn(McpServer.prototype, 'registerTool');

  const { createServerContext } = await import('../src/register/setup.js');
  const { defaultRegistration } = await import('../src/core/app-container.js');

  const ctx = await createServerContext();
  await defaultRegistration(ctx);

  const registrations = spy.mock.calls
    .map((call) => ({ name: call[0] } as Registration))
    .filter((r) => typeof r.name === 'string' && r.name.length > 0);

  return {
    names: registrations.map((r) => r.name),
    server: (ctx as unknown as { server: Surface['server'] }).server,
    tmp,
  };
}

async function disposeSurface(surface: Surface | undefined): Promise<void> {
  vi.restoreAllMocks();
  const close = surface?.server?.close;
  if (typeof close === 'function') {
    await close.call(surface!.server).catch(() => undefined);
  }
  if (surface?.tmp) {
    await fsp.rm(surface.tmp, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

describe('docs ↔ tool surface (catalog mode, generator env)', () => {
  let surface: Surface | undefined;

  beforeAll(async () => {
    surface = await collectSurface('catalog', {
      CATALOG_ENABLED: 'true',
      CATALOG_WRITE_ENABLED: 'false',
      MCP_TOOLS_ENABLED: 'true',
    });
  }, 120_000);

  afterAll(async () => {
    await disposeSurface(surface);
  });

  it('captures the real catalog-mode surface (guards below must not be vacuous)', () => {
    expect(surface).toBeDefined();
    expect(surface!.names.length).toBeGreaterThan(120);
    expect(surface!.names).toContain('service_catalog_health');
  });

  it('documents every registered tool in docs/features/tools.md as a table row', () => {
    const { rows, wildcards } = parseDocToolRows(fs.readFileSync(TOOLS_DOC, 'utf-8'));
    expect(rows.size, 'tools.md table looks empty — check the parser and the document').toBeGreaterThan(100);

    const missing = [...new Set(surface!.names)].sort().filter((name) => !isDocumented(name, rows, wildcards));
    expect(missing, `undocumented tools (add a table row to docs/features/tools.md): ${missing.join(', ')}`).toEqual([]);
  });

  it('publishes the live count and its breakdown in the generated api-reference header', () => {
    const header = fs.readFileSync(API_REF, 'utf-8').split('\n').slice(0, 10).join('\n');
    const total = /Всего инструментов:\s*\*\*(\d+)\*\*/.exec(header);
    const core = /(\d+)\s+по умолчанию/.exec(header);
    const dynamic = /(\d+)\s+динамических/.exec(header);

    expect(total, 'api-reference header lost the "Всего инструментов: **N**" line').not.toBeNull();
    expect(core, 'api-reference header lost the "N по умолчанию" breakdown').not.toBeNull();
    expect(dynamic, 'api-reference header lost the "N динамических" breakdown').not.toBeNull();

    const names = surface!.names;
    const liveCore = names.filter((n) => !n.startsWith('service_catalog_')).length;
    const liveDynamic = names.filter((n) => n.startsWith('service_catalog_')).length;

    expect(Number(total![1]), 'regenerate with `npm run api:reference`').toBe(names.length);
    expect(Number(core![1]), 'core count in the header drifted').toBe(liveCore);
    expect(Number(dynamic![1]), 'dynamic catalog count in the header drifted').toBe(liveDynamic);
  });
});

describe('docs ↔ tool surface (compact mode: MCP_TOOLS_ENABLED=false)', () => {
  let surface: Surface | undefined;

  beforeAll(async () => {
    surface = await collectSurface('compact', {
      CATALOG_ENABLED: 'false',
      MCP_TOOLS_ENABLED: 'false',
    });
  }, 120_000);

  afterAll(async () => {
    await disposeSurface(surface);
  });

  it('registers exactly the introspection whitelist on the wire', () => {
    expect(surface).toBeDefined();
    expect([...surface!.names].sort()).toEqual(COMPACT_WHITELIST);
  });

  it('does not register tools_batch in compact mode', () => {
    expect(surface!.names).not.toContain('tools_batch');
    expect(surface!.names).not.toContain('tasks_list');
  });

  it('documents the compact-mode contract in docs/features/tools.md', () => {
    const doc = fs.readFileSync(TOOLS_DOC, 'utf-8');
    expect(doc).toMatch(/MCP_TOOLS_ENABLED\s*=\s*(false|0)/);
    for (const name of COMPACT_WHITELIST) {
      expect(doc, `compact mode must name ${name}`).toContain(name);
    }
  });
});
