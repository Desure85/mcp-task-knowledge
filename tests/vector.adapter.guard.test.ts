import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function importFresh<T = any>(specifier: string): Promise<T> {
  vi.resetModules();
  const m = await import(specifier);
  return m as any;
}

const CONFIG_PATH = '../src/config.js';
const VECTOR_PATH = '../src/search/vector.js';

const ENV_SNAPSHOT = { ...process.env } as Record<string, string | undefined>;

describe('getVectorAdapter guards', () => {
  beforeEach(() => {
    process.env = { ...ENV_SNAPSHOT } as any;
    // minimal config
    process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/mcp-data';
    process.env.OBSIDIAN_VAULT_ROOT = process.env.OBSIDIAN_VAULT_ROOT || '/data/obsidian';
  });
  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT } as any;
  });

  it('returns undefined when EMBEDDINGS_MODE=none', async () => {
    process.env.EMBEDDINGS_MODE = 'none';
    const { getVectorAdapter } = await importFresh<any>(VECTOR_PATH);
    const adapter = await getVectorAdapter<any>();
    expect(adapter).toBeUndefined();
  });

  it('returns undefined when modelPath or dim missing', async () => {
    process.env.EMBEDDINGS_MODE = 'onnx-cpu';
    delete process.env.EMBEDDINGS_MODEL_PATH;
    delete process.env.EMBEDDINGS_DIM;
    const { getVectorAdapter } = await importFresh<any>(VECTOR_PATH);
    const adapter = await getVectorAdapter<any>();
    expect(adapter).toBeUndefined();
  });
});
