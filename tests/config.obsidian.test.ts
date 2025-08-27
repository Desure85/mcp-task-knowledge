import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP = path.join(process.cwd(), '.tmp-tests-config');

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

describe('config: vaultRoot resolution and DATA_DIR requirement', () => {
  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(TMP, { recursive: true });
  });

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('defaults OBSIDIAN_VAULT_ROOT to /data/obsidian when not set and no config', async () => {
    // Isolate env
    delete process.env.MCP_CONFIG_JSON;
    delete process.env.OBSIDIAN_VAULT_ROOT;
    process.env.DATA_DIR = TMP;

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();
    expect(cfg.obsidian.vaultRoot).toBe('/data/obsidian');
  });

  it('uses OBSIDIAN_VAULT_ROOT env override when provided', async () => {
    delete process.env.MCP_CONFIG_JSON;
    const custom = path.join(TMP, 'vault');
    process.env.OBSIDIAN_VAULT_ROOT = custom;
    process.env.DATA_DIR = TMP;

    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();
    expect(cfg.obsidian.vaultRoot).toBe(custom);
  });

  it('throws when DATA_DIR is missing', async () => {
    delete process.env.MCP_CONFIG_JSON;
    delete process.env.DATA_DIR;
    process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP, 'vault');

    // Ensure re-evaluating module top-level by resetting module cache
    await vi.resetModules();
    await expect(import('../src/config.js')).rejects.toThrow(/DATA_DIR must be set/);
  });
});
