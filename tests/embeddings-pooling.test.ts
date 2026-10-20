import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePooling, readPoolingConfig } from '../src/search/vector.js';

describe('embedding pooling selection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), '.tmp-pooling-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(path.join(tempDir, 'onnx'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'onnx', 'model.onnx'), '');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lets the environment override the model config', () => {
    expect(resolvePooling('cls', { mean: true })).toBe('cls');
    expect(resolvePooling('MEAN', { cls: true })).toBe('mean');
    expect(resolvePooling('model', { cls: true })).toBe('model');
    expect(resolvePooling('nonsense', { cls: true })).toBe('cls');
  });

  it('follows the model config when no env override is set', () => {
    expect(resolvePooling(undefined, { cls: true })).toBe('cls');
    expect(resolvePooling(undefined, { mean: true })).toBe('mean');
    expect(resolvePooling(undefined, undefined)).toBe('model');
  });

  it('reads 1_Pooling/config.json from the model root', () => {
    fs.mkdirSync(path.join(tempDir, '1_Pooling'));
    fs.writeFileSync(
      path.join(tempDir, '1_Pooling', 'config.json'),
      JSON.stringify({ pooling_mode_cls_token: true, pooling_mode_mean_tokens: false }),
    );
    expect(readPoolingConfig(path.join(tempDir, 'onnx', 'model.onnx'))).toEqual({ cls: true, mean: false });
  });

  it('returns undefined when the model ships no pooling config', () => {
    expect(readPoolingConfig(path.join(tempDir, 'onnx', 'model.onnx'))).toBeUndefined();
  });
});
