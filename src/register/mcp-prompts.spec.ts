/**
 * src/register/mcp-prompts.spec.ts — SPEC-03 unit tests.
 *
 * Covers registerMcpPrompts(): catalog-driven registration of native MCP
 * prompts, argsSchema derivation from variables[], template rendering with
 * {{var}} substitution, and failure isolation (missing catalog, catalog
 * errors, unreadable files, non-prompt kinds).
 *
 * Convention (same as tests/prompts.build.test.ts): config.ts resolves
 * PROMPTS_DIR at module load, so env is set in beforeAll and the module under
 * test is pulled in via dynamic import() inside each test.
 */

import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const PROJECT = 'mcp';
let TMP: string;
let restoreEnv: Record<string, string | undefined> = {};

interface RegisteredPrompt {
  name: string;
  config: { title?: string; description?: string; argsSchema?: Record<string, unknown> };
  cb: (args: Record<string, unknown>) => Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }>;
}

const SENTINEL = '__mcp_prompts_placeholder';

function makeCtx() {
  const registered: RegisteredPrompt[] = [];
  const ctx = {
    REPO_ROOT: TMP,
    server: {
      registerPrompt: (name: string, config: RegisteredPrompt['config'], cb: RegisteredPrompt['cb']) => {
        registered.push({ name, config, cb });
        return { name, disable: () => undefined, enable: () => undefined, remove: () => undefined, update: () => undefined };
      },
    },
  };
  return { ctx: ctx as any, registered };
}

/** User-registered prompts, excluding the empty-library sentinel. */
function userPrompts(registered: RegisteredPrompt[]): RegisteredPrompt[] {
  return registered.filter((r) => r.name !== SENTINEL);
}

async function writePromptFile(
  id: string,
  version: string,
  opts: { kind?: string; template?: string; variables?: Array<{ name: string; required?: boolean }>; title?: string; description?: string } = {},
) {
  const dir = path.join(TMP, PROJECT, 'prompts');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}@${version}.json`);
  const doc = {
    type: 'prompt',
    id,
    version,
    metadata: {
      title: opts.title ?? id,
      domain: 'test',
      status: 'published',
      kind: opts.kind ?? 'prompt',
      ...(opts.description ? { description: opts.description } : {}),
    },
    template: opts.template ?? `template for ${id}`,
    variables: opts.variables ?? [],
  };
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return file;
}

async function writeCatalog(items: Record<string, unknown>) {
  const dir = path.join(TMP, PROJECT, 'exports', 'catalog');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'prompts.catalog.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2),
    'utf8',
  );
}

function catalogItem(id: string, version: string, relPath: string, opts: { kind?: string; errors?: unknown[] } = {}) {
  return {
    id,
    kind: opts.kind ?? 'prompt',
    status: 'published',
    domain: 'test',
    title: id,
    tags: [],
    latest: version,
    versions: [version],
    files: [{ version, path: relPath, errors: opts.errors ?? [], metadata: { title: id } }],
  };
}

beforeAll(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-prompts-spec-'));
  restoreEnv.MCP_PROMPTS_DIR = process.env.MCP_PROMPTS_DIR;
  restoreEnv.DATA_DIR = process.env.DATA_DIR;
  restoreEnv.CURRENT_PROJECT = process.env.CURRENT_PROJECT;
  process.env.MCP_PROMPTS_DIR = TMP;
  process.env.DATA_DIR = TMP;
  process.env.CURRENT_PROJECT = PROJECT;
});

afterAll(async () => {
  if (restoreEnv.MCP_PROMPTS_DIR === undefined) delete process.env.MCP_PROMPTS_DIR;
  else process.env.MCP_PROMPTS_DIR = restoreEnv.MCP_PROMPTS_DIR;
  if (restoreEnv.DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = restoreEnv.DATA_DIR;
  if (restoreEnv.CURRENT_PROJECT === undefined) delete process.env.CURRENT_PROJECT;
  else process.env.CURRENT_PROJECT = restoreEnv.CURRENT_PROJECT;
  await fs.rm(TMP, { recursive: true, force: true });
});

async function freshModule() {
  const mod = await import('./mcp-prompts.js');
  return mod.registerMcpPrompts;
}

describe('SPEC-03: registerMcpPrompts', () => {
  it('registers one MCP prompt per catalog item (latest version, no errors)', async () => {
    const f1 = await writePromptFile('alpha', '1.0.0', { template: 'A {{x}}', variables: [{ name: 'x', required: true }] });
    const f2 = await writePromptFile('beta', '2.0.0', { template: 'B' });
    await writeCatalog({
      alpha: catalogItem('alpha', '1.0.0', path.relative(TMP, f1)),
      beta: catalogItem('beta', '2.0.0', path.relative(TMP, f2)),
    });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    expect(registered.map((r) => r.name).sort()).toEqual(['alpha', 'beta']);
    expect(registered.find((r) => r.name === 'alpha')?.config.title).toBe('alpha');
  });

  it('builds argsSchema from variables: required → z.string(), optional → z.string().optional()', async () => {
    const f = await writePromptFile('withvars', '1.0.0', {
      template: 'hi {{req}} {{opt}}',
      variables: [
        { name: 'req', required: true },
        { name: 'opt', required: false },
      ],
    });
    await writeCatalog({ withvars: catalogItem('withvars', '1.0.0', path.relative(TMP, f)) });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    const schema = registered[0]?.config.argsSchema ?? {};
    expect(Object.keys(schema).sort()).toEqual(['opt', 'req']);
    // required → not optional; optional → ZodOptional wrapper
    expect((schema.req as any).isOptional()).toBe(false);
    expect((schema.opt as any).isOptional()).toBe(true);
  });

  it('callback renders {{var}} placeholders; missing optional → empty string', async () => {
    const f = await writePromptFile('render_me', '1.0.0', {
      template: 'Hello {{name}}, you are {{role}}!',
      variables: [
        { name: 'name', required: true },
        { name: 'role', required: false },
      ],
    });
    await writeCatalog({ render_me: catalogItem('render_me', '1.0.0', path.relative(TMP, f)) });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    const res = await registered[0].cb({ name: 'Ada' });
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].role).toBe('user');
    expect(res.messages[0].content.type).toBe('text');
    expect(res.messages[0].content.text).toBe('Hello Ada, you are !');
  });

  it('registers only the disabled sentinel when catalog is missing (prompts/list stays answerable)', async () => {
    await fs.rm(path.join(TMP, PROJECT, 'exports'), { recursive: true, force: true });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    expect(userPrompts(registered)).toHaveLength(0);
    expect(registered.map((r) => r.name)).toEqual([SENTINEL]);
  });

  it('skips items whose latest file has catalog errors', async () => {
    const f = await writePromptFile('broken', '1.0.0', {});
    await writeCatalog({
      broken: catalogItem('broken', '1.0.0', path.relative(TMP, f), { errors: ['template required string'] }),
    });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    expect(userPrompts(registered)).toHaveLength(0);
  });

  it('skips non-prompt kinds (rules/workflows stay tool-only)', async () => {
    const dir = path.join(TMP, PROJECT, 'rules');
    await fs.mkdir(dir, { recursive: true });
    const ruleFile = path.join(dir, 'myrule@1.0.0.json');
    await fs.writeFile(ruleFile, JSON.stringify({
      type: 'prompt', id: 'myrule', version: '1.0.0',
      metadata: { title: 'myrule', domain: 'test', status: 'published', kind: 'rule' },
      template: 'rule body', variables: [],
    }), 'utf8');
    await writeCatalog({
      myrule: catalogItem('myrule', '1.0.0', path.relative(TMP, ruleFile), { kind: 'rule' }),
    });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    expect(userPrompts(registered)).toHaveLength(0);
  });

  it('skips unreadable/invalid prompt files without crashing', async () => {
    const badDir = path.join(TMP, PROJECT, 'prompts');
    await fs.mkdir(badDir, { recursive: true });
    const badFile = path.join(badDir, 'garbage@1.0.0.json');
    await fs.writeFile(badFile, '{not json', 'utf8');
    await writeCatalog({
      garbage: catalogItem('garbage', '1.0.0', path.relative(TMP, badFile)),
    });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await expect(registerMcpPrompts(ctx)).resolves.toBeUndefined();
    expect(userPrompts(registered)).toHaveLength(0);
  });

  it('skips catalog paths that escape the project root', async () => {
    await writeCatalog({
      escape: catalogItem('escape', '1.0.0', '../../outside.json'),
    });
    const registerMcpPrompts = await freshModule();
    const { ctx, registered } = makeCtx();
    await registerMcpPrompts(ctx);
    expect(userPrompts(registered)).toHaveLength(0);
  });
});
