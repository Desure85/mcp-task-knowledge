import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = process.env.EMBEDDINGS_MODEL_PATH ?? '';
const HAS_MODEL = Boolean(MODEL && fs.existsSync(MODEL));
let dataDir = '';

beforeAll(async () => {
  if (!HAS_MODEL) return;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph013-vector-'));
  process.env.DATA_DIR = dataDir;
  process.env.EMBEDDINGS_MODE = 'onnx-cpu';
  process.env.EMBEDDINGS_MODEL_PATH = MODEL;
  process.env.EMBEDDINGS_DIM = process.env.EMBEDDINGS_DIM ?? '384';
  process.env.EMBEDDINGS_CACHE_DIR = path.join(dataDir, 'cache');
  process.env.ONNXRUNTIME_NODE_EXECUTION_PROVIDERS = 'cpu';
  vi.resetModules();
});

afterAll(() => {
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!HAS_MODEL)('PH-013 vector e2e', () => {
  it('loads a real ONNX encoder and ranks a semantic match first', async () => {
    const { getVectorAdapter } = await import('../src/search/vector.js');
    const adapter = await getVectorAdapter<{ id: string }>();
    expect(adapter, 'vector adapter must initialize with a real model').toBeDefined();

    const results = await adapter!.search(
      'feline sitting on a rug',
      [
        { id: 'cat', text: 'A cat is sitting on the mat', item: { id: 'cat' } },
        { id: 'finance', text: 'Quarterly finance report and budget forecast', item: { id: 'finance' } },
      ],
      { limit: 1 },
    );
    expect(results[0]?.item.id).toBe('cat');
    expect(results[0]?.score).toBeGreaterThan(0);
  }, 180_000);
});
