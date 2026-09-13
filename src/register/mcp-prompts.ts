/**
 * src/register/mcp-prompts.ts — SPEC-03: MCP-native prompts surface.
 *
 * The prompt library was previously exposed ONLY as tools (prompts_list,
 * prompts_get, prompts_search, ...). MCP clients that render a native
 * "Prompts" section (Claude Desktop, IDEs, inspectors) call prompts/list —
 * which returned -32601 because registerPrompt had zero call sites.
 *
 * This module bridges the gap: at startup it reads the prompts catalog for
 * the current project and registers each published prompt file as a native
 * MCP prompt via ctx.server.registerPrompt().
 *
 * Design decisions:
 *   - Name mapping: MCP prompt name === prompt `id` as-is (e.g. `bug_triage`).
 *     The `prompts_*` tools remain for programmatic use; MCP prompts are the
 *     client-UI surface for the same library. No prefix — ids are already
 *     namespaced by convention (snake_case, unique per project).
 *   - argsSchema: built from the prompt file's `variables[]` — every variable
 *     becomes a zod string (MCP prompt args are always strings on the wire);
 *     `required: true` → z.string(), otherwise → z.string().optional().
 *   - Rendering: `{{name}}` placeholders are substituted with provided args;
 *     missing optional args render as empty string. Missing required args are
 *     rejected by the SDK's argsSchema validation before the callback runs.
 *   - Snapshot semantics: prompts are registered once at startup from the
 *     current catalog. New/updated prompts require a server restart to appear
 *     in prompts/list (listChanged notifications are SPEC-04, out of scope).
 *   - Failure isolation: missing catalog → zero prompts registered (info log);
 *     a corrupt prompt file → that prompt is skipped (warn log). Neither case
 *     may crash startup.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { PROMPTS_DIR, resolveProject } from '../config.js';
import { readPromptsCatalog } from './helpers.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('mcp-prompts');

/** Shape of a single file entry inside a catalog item. */
interface CatalogFileEntry {
  version?: string;
  /** Path relative to the project root (PROMPTS_DIR/<project>). */
  path?: string;
  errors?: unknown[];
  metadata?: Record<string, unknown> | null;
}

/** Shape of a catalog item as written by exportCatalog(). */
interface CatalogItem {
  id?: string;
  kind?: string | null;
  latest?: string | null;
  versions?: string[];
  files?: CatalogFileEntry[];
}

/** Shape of a prompt source file (.data/prompts/<prj>/prompts/<id>@<ver>.json). */
interface PromptFile {
  type?: string;
  id?: string;
  version?: string;
  metadata?: {
    title?: string;
    description?: string;
    kind?: string;
    status?: string;
    domain?: string;
    tags?: string[];
  };
  template?: string;
  variables?: Array<{ name?: string; type?: string; required?: boolean }>;
}

/**
 * Load and parse a prompt file. Returns null on any failure (missing file,
 * invalid JSON, wrong shape) — callers skip the prompt in that case.
 */
async function loadPromptFile(absPath: string): Promise<PromptFile | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as PromptFile;
  } catch {
    return null;
  }
}

/**
 * Build a zod raw-shape argsSchema from the prompt's variables list.
 * MCP prompt arguments are always strings; `required` maps to optionality.
 */
function buildArgsSchema(prompt: PromptFile): Record<string, z.ZodString | z.ZodOptional<z.ZodString>> {
  const shape: Record<string, z.ZodString | z.ZodOptional<z.ZodString>> = {};
  for (const v of prompt.variables ?? []) {
    const name = v?.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    shape[name] = v.required === true ? z.string() : z.string().optional();
  }
  return shape;
}

/**
 * Render a prompt template: substitute {{name}} with args[name].
 * Missing optional args → empty string. Unknown {{placeholders}} that have no
 * matching variable are left untouched (they may be literal braces in text).
 */
function renderTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name: string) => {
    const value = args[name];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Register every cataloged prompt as a native MCP prompt.
 *
 * Reads the prompts catalog for the resolved project, picks each item's
 * `latest` version file (skipping entries with validation errors), and calls
 * ctx.server.registerPrompt() so MCP clients see them in prompts/list.
 *
 * Safe to call unconditionally at startup: returns early (with an info log)
 * when no catalog exists yet — e.g. a fresh DATA_DIR before the first reindex.
 */
export async function registerMcpPrompts(ctx: ServerContext): Promise<void> {
  const project = resolveProject(undefined);
  const catalog = await readPromptsCatalog(project);
  let registered = 0;

  const items = catalog && typeof catalog === 'object' && catalog.items
    ? (catalog.items as Record<string, CatalogItem>)
    : null;
  if (!items) {
    log.info({ project }, 'no prompts catalog — registering empty prompts surface');
  }

  for (const [id, rawItem] of Object.entries<CatalogItem>(items ?? {})) {
    try {
      const item = rawItem;
      const latest = item?.latest;
      if (!latest) continue;

      // Only kind 'prompt' (or unset) is surfaced as an MCP prompt — rules,
      // workflows, templates and policies stay tool-only: they are building
      // blocks for composition, not end-user prompt templates.
      const kind = item.kind ?? 'prompt';
      if (kind !== 'prompt') continue;

      const fileEntry = (item.files ?? []).find((f) => f.version === latest);
      if (!fileEntry?.path) continue;
      if (Array.isArray(fileEntry.errors) && fileEntry.errors.length > 0) {
        log.warn({ project, id, version: latest, errors: fileEntry.errors }, 'skipping prompt with catalog errors');
        continue;
      }

      // Catalog paths are relative to the repo root (scripts/prompts.mjs
      // writes path.relative(PROJECT_ROOT, file)); when MCP_PROMPTS_DIR lives
      // outside the repo the relative path can legitimately point outside it,
      // so accept paths under either REPO_ROOT or PROMPTS_DIR.
      const absPath = path.resolve(ctx.REPO_ROOT, fileEntry.path);
      const withinRepo = absPath.startsWith(ctx.REPO_ROOT + path.sep);
      const withinPrompts = absPath.startsWith(PROMPTS_DIR + path.sep);
      if (!withinRepo && !withinPrompts) {
        log.warn({ project, id, path: fileEntry.path }, 'skipping prompt with path outside repo and prompts dirs');
        continue;
      }

      const prompt = await loadPromptFile(absPath);
      if (!prompt || prompt.type !== 'prompt' || typeof prompt.template !== 'string') {
        log.warn({ project, id, path: fileEntry.path }, 'skipping unreadable or non-prompt file');
        continue;
      }

      const argsSchema = buildArgsSchema(prompt);
      const title = prompt.metadata?.title ?? id;
      const description = prompt.metadata?.description ?? '';

      ctx.server.registerPrompt(
        id,
        {
          title,
          description,
          ...(Object.keys(argsSchema).length > 0 ? { argsSchema } : {}),
        },
        async (args: Record<string, unknown>) => {
          // Re-read the file at call time so edits between startup and use
          // are picked up without a restart (registration is a snapshot of
          // the catalog; the template body is always fresh).
          const current = await loadPromptFile(absPath);
          const template = current?.template ?? prompt.template;
          const rendered = renderTemplate(template ?? '', args ?? {});
          return {
            messages: [
              {
                role: 'user' as const,
                content: { type: 'text' as const, text: rendered },
              },
            ],
          };
        },
      );
      registered++;
    } catch (e) {
      log.warn({ project, id, err: e }, 'failed to register MCP prompt — skipped');
    }
  }

  // The server always advertises the prompts capability (SERVER_CAPS), so
  // prompts/list must answer even when the library is empty. The SDK installs
  // the list/get handlers on first registerPrompt() call only — without this
  // sentinel an empty library would answer -32601 instead of { prompts: [] }.
  // The sentinel is disabled, so it never shows up in prompts/list.
  if (registered === 0) {
    const sentinel = ctx.server.registerPrompt(
      '__mcp_prompts_placeholder',
      { title: 'placeholder', description: 'internal — no user prompts registered' },
      async () => ({ messages: [] }),
    );
    sentinel.disable();
  }

  log.info({ project, registered }, 'MCP prompts registered');
}
