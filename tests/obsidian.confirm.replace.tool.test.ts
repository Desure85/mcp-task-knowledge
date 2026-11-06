/**
 * TR-04a: confirm gate for obsidian replace lives in the tool layer
 * (src/register/obsidian.ts), not in the direct impl. This test invokes the
 * registered handlers, so removing the gate makes it fail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), `tr04a-confirm-${process.pid}-${Date.now()}`);
const DATA = path.join(TMP, 'data');
const VAULT = path.join(TMP, 'vault');

// Must be set before config.ts is loaded (dynamic import below).
process.env.DATA_DIR = DATA;
process.env.OBSIDIAN_VAULT_ROOT = VAULT;

type Handler = (params: Record<string, unknown>, extra?: unknown) => Promise<unknown>;
type Envelope = { ok: boolean; error?: { message?: string }; data?: unknown };

let handlers: Map<string, Handler>;

async function call(name: string, args: Record<string, unknown>): Promise<Envelope> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`handler not registered: ${name}`);
  const result = (await handler(args, {})) as { content?: Array<{ text?: string }> };
  const text = result?.content?.[0]?.text;
  return (typeof text === 'string' ? JSON.parse(text) : result) as Envelope;
}

async function vaultEntries(): Promise<string[]> {
  try {
    return (await fsp.readdir(VAULT)).sort();
  } catch {
    return [];
  }
}

beforeAll(async () => {
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.mkdir(VAULT, { recursive: true });
  handlers = new Map();
  const ctx = {
    server: {
      registerTool(name: string, _def: unknown, handler: unknown) {
        handlers.set(name, handler as Handler);
      },
    },
  } as any;
  const { registerObsidianTools } = await import('../src/register/obsidian.js');
  registerObsidianTools(ctx);
});

afterAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

describe('obsidian confirm gate (tool layer)', () => {
  it('export replace without confirm -> refused, vault untouched', async () => {
    const before = await vaultEntries();
    const res = await call('obsidian_export_project', { project: 'mcp', strategy: 'replace' });
    expect(res.ok).toBe(false);
    expect(res.error?.message ?? '').toContain('not confirmed');
    expect(await vaultEntries()).toEqual(before);
  });

  it('export replace with confirm:true -> proceeds', async () => {
    const res = await call('obsidian_export_project', { project: 'mcp', strategy: 'replace', confirm: true });
    expect(res.ok).toBe(true);
  });

  it('import replace without confirm -> refused, vault untouched', async () => {
    const before = await vaultEntries();
    const res = await call('obsidian_import_project', { project: 'mcp', strategy: 'replace' });
    expect(res.ok).toBe(false);
    expect(res.error?.message ?? '').toContain('not confirmed');
    expect(await vaultEntries()).toEqual(before);
  });

  it('import replace with confirm:true -> proceeds', async () => {
    const res = await call('obsidian_import_project', { project: 'mcp', strategy: 'replace', confirm: true });
    expect(res.ok).toBe(true);
  });
});
