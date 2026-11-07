/**
 * TR-04c: tool-registration contract, checked on the REAL registration path.
 *
 * The previous version scanned `src/index.ts` for `registerTool(`. Since TD-001
 * that file is a 22-line delegate with zero matches, so the regex found an empty
 * set and every assertion held vacuously — the test could not fail.
 *
 * Now the SUT is production code:
 *   `createServerContext()`            builds the real `McpServer`
 *   `defaultRegistration(ctx)`         src/core/app-container.ts:161 — wires every
 *                                      `register*Tools` module exactly as the server does
 *   `src/register/setup.ts:299`        replaces `server.registerTool` with a wrapper
 *                                      that guards duplicates and feeds the registry
 *
 * The spy is installed on that instance method *after* the context exists, so it
 * wraps the production wrapper (not the SDK prototype): every registration attempt
 * is captured, including a duplicate one that the wrapper would silently skip.
 *
 * Wire-level shape (`{type:'object', properties}` in `tools/list`) is covered by
 * tests/e2e-full/tcp-transport.test.ts:166 and tests/e2e-full/mcp-inspector.test.ts:37.
 * This file checks the in-process contract — names, descriptions, raw zod shapes,
 * uniqueness — without spawning a server and without requiring a build.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';

// config.ts resolves DATA_DIR at module load; must be set before the dynamic imports.
const TMP = path.join(os.tmpdir(), `tr04c-contract-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = TMP;
process.env.EMBEDDINGS_MODE = 'none';
process.env.CATALOG_ENABLED = 'false';

interface Registration {
  name: string;
  def?: { description?: unknown; inputSchema?: unknown };
}

/**
 * Bulk-only policy (kept from the original file): single archive/trash/restore/
 * delete_permanent and knowledge create/update must go through bulk variants.
 * tasks_create/update/close are intentionally allowed (MR-002 hierarchy).
 */
const BANNED_SINGLE_TOOLS = [
  'tasks_archive',
  'tasks_trash',
  'tasks_restore',
  'tasks_delete_permanent',
  'knowledge_create',
  'knowledge_update',
  'knowledge_archive',
  'knowledge_trash',
  'knowledge_restore',
  'knowledge_delete_permanent',
];

/** Minimum core the CLI contract promises. Subset check, not an exact count. */
const REQUIRED_CORE = [
  'tasks_list',
  'tasks_create',
  'tasks_get',
  'tasks_close',
  'tasks_tree',
  'tasks_add_subtask',
  'knowledge_list',
  'knowledge_get',
  'knowledge_tree',
  'search_knowledge',
  'search_tasks',
  'project_list',
  'project_create',
  'project_set_current',
  'memory_temporal_add',
  'memory_temporal_query',
  'memory_extract',
  'admin_backup',
  'admin_restore',
];

describe('tool registration contract (real registration path)', () => {
  let registrations: Registration[] = [];
  let ctx: { server: { close: () => Promise<void> } } | undefined;

  beforeAll(async () => {
    await fsp.mkdir(TMP, { recursive: true });
    const { createServerContext } = await import('../src/register/setup.js');
    const { defaultRegistration } = await import('../src/core/app-container.js');

    ctx = (await createServerContext()) as unknown as typeof ctx;

    const spy = vi.spyOn(
      ctx!.server as unknown as { registerTool: (...args: unknown[]) => unknown },
      'registerTool',
    );
    await defaultRegistration(ctx as never);

    registrations = spy.mock.calls.map((call) => ({
      name: call[0] as string,
      def: call[1] as Registration['def'],
    }));
  }, 120000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await ctx?.server.close().catch(() => undefined);
    await fsp.rm(TMP, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('captures a non-empty registration set (the check below must not be vacuous)', () => {
    // The old test proved nothing because it captured zero names. A floor keeps
    // this file honest if the registration wiring silently stops running.
    expect(registrations.length).toBeGreaterThan(100);
    expect(registrations.every((r) => typeof r.name === 'string' && r.name.length > 0)).toBe(true);
  });

  it('does not register banned single-tools', () => {
    const names = new Set(registrations.map((r) => r.name));
    const foundBanned = BANNED_SINGLE_TOOLS.filter((banned) => names.has(banned));
    expect(foundBanned, `banned single-tools present: ${foundBanned.join(', ')}`).toEqual([]);
  });

  it('registers the required core tools', () => {
    const names = new Set(registrations.map((r) => r.name));
    const missing = REQUIRED_CORE.filter((required) => !names.has(required));
    expect(missing, `required tools missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives every tool a non-empty description', () => {
    const withoutDescription = registrations
      .filter((r) => typeof r.def?.description !== 'string' || (r.def.description as string).trim() === '')
      .map((r) => r.name);
    expect(withoutDescription, `tools without description: ${withoutDescription.join(', ')}`).toEqual([]);
  });

  it('gives every tool an object inputSchema of zod validators', () => {
    const badSchema = registrations
      .filter((r) => typeof r.def?.inputSchema !== 'object' || r.def?.inputSchema === null)
      .map((r) => r.name);
    expect(badSchema, `tools with non-object inputSchema: ${badSchema.join(', ')}`).toEqual([]);

    // A non-empty raw shape proves the schema is real rather than `{}`.
    const tasksCreate = registrations.find((r) => r.name === 'tasks_create');
    expect(tasksCreate).toBeDefined();
    expect(Object.keys(tasksCreate!.def!.inputSchema as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['title', 'project']),
    );
  });

  it('registers each tool name once', () => {
    const names = registrations.map((r) => r.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates, `duplicate tool names: ${[...new Set(duplicates)].join(', ')}`).toEqual([]);
  });
});
