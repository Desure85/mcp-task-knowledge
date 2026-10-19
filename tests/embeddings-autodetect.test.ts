import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const ENV_SNAPSHOT = { ...process.env } as Record<string, string | undefined>;

describe('embeddings model auto-detection', () => {
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...ENV_SNAPSHOT } as Record<string, string | undefined>;
    tempDir = path.join(process.cwd(), '.tmp-autodetect-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DATA_DIR = tempDir;
    process.env.OBSIDIAN_VAULT_ROOT = path.join(tempDir, 'vault');
    process.env.EMBEDDINGS_MODE = 'onnx-cpu';
    process.env.EMBEDDINGS_AUTODETECT = '1';
    delete process.env.EMBEDDINGS_MODEL_PATH;
    delete process.env.EMBEDDINGS_DIM;
    delete process.env.EMBEDDINGS_QUERY_PREFIX;
    delete process.env.EMBEDDINGS_DOC_PREFIX;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ENV_SNAPSHOT } as Record<string, string | undefined>;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers an EmbeddingGemma bundle over a legacy encoder.onnx', async () => {
    const { modelCandidates } = await import('../src/config.js');
    const candidates = modelCandidates();
    expect(candidates[0]).toMatch(/gemma-q4\/onnx\/model_q4\.onnx$/);
    expect(candidates[candidates.length - 1]).toMatch(/encoder\.onnx$/);
    expect(candidates.some((c) => c.includes('berta-int8'))).toBe(true);
  });

  it('auto-detects the gemma bundle and applies its instruction prefixes', async () => {
    const bundle = path.join(tempDir, 'models', 'gemma-q4', 'onnx');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, 'model_q4.onnx'), '');
    fs.writeFileSync(path.join(bundle, '..', 'config.json'), JSON.stringify({ text_config: { hidden_size: 512, max_position_embeddings: 2048 } }));

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.embeddings.mode).toBe('onnx-cpu');
    expect(config.embeddings.modelPath).toBe(path.join(bundle, 'model_q4.onnx'));
    expect(config.embeddings.queryPrefix).toBe('task: search result | query:');
    expect(config.embeddings.docPrefix).toBe('title: none | text:');
  });

  it('keeps an explicitly configured prefix', async () => {
    const bundle = path.join(tempDir, 'models', 'gemma-q4', 'onnx');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, 'model_q4.onnx'), '');
    process.env.EMBEDDINGS_QUERY_PREFIX = 'custom query:';

    const { loadConfig } = await import('../src/config.js');
    expect(loadConfig().embeddings.queryPrefix).toBe('custom query:');
  });

  it('does not require EMBEDDINGS_DIM when the model file exists', async () => {
    const bundle = path.join(tempDir, 'models', 'gemma-q4', 'onnx');
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, 'model_q4.onnx'), '');

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    expect(config.embeddings.mode).not.toBe('none');
    expect(config.embeddings.dim).toBeUndefined();
  });
});
