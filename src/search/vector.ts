import { type VectorSearchAdapter } from './index.js';
import { type SearchResult } from '../types.js';
import { loadConfig } from '../config.js';
import { EmbeddingsCache } from './emb_cache.js';
import { childLogger } from '../core/logger.js';
import type { InferenceSession, TensorConstructor, SessionCreateOptions, ExecutionProviderConfig } from 'onnxruntime-web';
import type { XenovaTokenizer, XenovaEnv, TokenizerOutput, TokenizerEncodeOptions } from '@xenova/transformers';

const log = childLogger('vector');

// Cosine similarity for Float32Array vectors
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class NoopVectorAdapter<T> implements VectorSearchAdapter<T> {
  async search(_query: string, _items: Array<{ id: string; text: string; item: T }>, opts?: { limit?: number }): Promise<SearchResult<T>[]> {
    return [];
  }
}

/** Normalize an array-like value (possibly bigint/TypedArray) to number[]. */
function toNumberArray(arr: ArrayLike<number | bigint> | { data?: ArrayLike<number | bigint> }): number[] {
  if (!arr) return [];
  // Typed arrays (Int64Array, etc.)
  if (ArrayBuffer.isView(arr)) {
    const v = arr as ArrayLike<number | bigint>;
    const out: number[] = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = Number(v[i]);
    return out;
  }
  // Regular array (may contain bigint/objects)
  if (Array.isArray(arr)) return arr.map((v: number | bigint) => Number((v as unknown as { valueOf(): number | bigint })?.valueOf?.() ?? v));
  // Object with 'data' field
  if (typeof arr === 'object' && arr !== null && 'data' in (arr as Record<string, unknown>)) {
    return toNumberArray((arr as { data: ArrayLike<number | bigint> }).data);
  }
  return [];
}

export class OnnxVectorAdapter<T> implements VectorSearchAdapter<T> {
  private ready = false;
  private encodeText!: (text: string) => Promise<Float32Array>;
  private encodeBatch!: (texts: string[]) => Promise<Float32Array[]>;
  private dim: number;
  private maxLen = 256;
  private session!: InferenceSession;
  private tokenizer!: XenovaTokenizer;
  private tokenizerKind: 'hf-tokenizers' | 'xenova' | undefined;
  private cache?: EmbeddingsCache;
  private ortTensorCtor!: TensorConstructor;

  constructor(dim: number) {
    this.dim = dim;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    const cfg = loadConfig();
    if (cfg.embeddings.mode === 'none') {
      this.ready = false;
      return;
    }
    try {
      // Select ORT backend dynamically: GPU -> onnxruntime-node (CUDA), else -> onnxruntime-web (WASM)
      const MODE = (process.env.EMBEDDINGS_MODE || '').toLowerCase();
      const useGpu = MODE === 'onnx-gpu' || MODE === 'gpu' || MODE === 'cuda';
      // Use onnxruntime-node for GPU, otherwise onnxruntime-web (WASM) for CPU
      type OrtModule = { InferenceSession: { create(model: ArrayBuffer | Uint8Array | string, options?: SessionCreateOptions): Promise<InferenceSession> }; Tensor: TensorConstructor; env?: XenovaEnv };
      let ortModule: OrtModule | null = null;
      if (useGpu) {
        ortModule = await import('onnxruntime-node').catch((): null => null) as OrtModule | null;
      } else {
        ortModule = await import('onnxruntime-web').catch((): null => null) as OrtModule | null;
      }
      if (!ortModule) {
        log.warn('onnxruntime-web not installed; disabling vector adapter');
        this.ready = false;
        return;
      }
      const ort = ortModule; // const for TS narrowing
      this.ortTensorCtor = ort.Tensor;
      const fsp = await import('node:fs/promises');
      const fs = await import('node:fs');
      const DEBUG = (process.env.DEBUG_VECTOR === '1' || process.env.DEBUG_VECTOR === 'true');
      // Use @xenova/transformers (pure JS) with local FS support
      const xenova = await import('@xenova/transformers').catch((): null => null) as { env: XenovaEnv; AutoTokenizer: { from_pretrained(modelPath: string, options?: Record<string, unknown>): Promise<XenovaTokenizer> } } | null;
      if (!xenova) {
        log.warn('@xenova/transformers not available. Disabling vector adapter');
        this.ready = false;
        return;
      }

      // Apply configured maxLen if provided
      if (cfg.embeddings.maxLen && cfg.embeddings.maxLen > 0) {
        this.maxLen = cfg.embeddings.maxLen;
      }

      // Infer maxLen and dim from metadata if present
      try {
        const metaPath = '/app/models/metadata.json';
        if (fs.existsSync(metaPath)) {
          const raw = await fsp.readFile(metaPath, 'utf8');
          const meta = JSON.parse(raw);
          const hidden = Number(meta?.hidden_size ?? meta?.hiddenSize);
          if (!Number.isNaN(hidden)) this.dim = hidden;
          const maxp = Number(meta?.max_position_embeddings ?? meta?.maxLen);
          if (!Number.isNaN(maxp) && !cfg.embeddings.maxLen) this.maxLen = Math.min(512, Math.max(16, maxp));
        }
      } catch {}

      // onnxruntime: ensure model path is set
      if (!cfg.embeddings.modelPath) {
        log.warn('embeddings.modelPath not set; disabling vector adapter');
        this.ready = false;
        return;
      }
      // IMPORTANT:
      // - For onnxruntime-node (native, GPU/CPU) pass a filesystem path string.
      //   Passing raw bytes can lead to provider loading issues in some builds.
      // - For onnxruntime-web (WASM) pass the model bytes.
      const createOpts: SessionCreateOptions = {};
      let modelSource: ArrayBuffer | Uint8Array | string;
      if (useGpu && ort.InferenceSession) {
        if (DEBUG) {
          log.debug('init: useGpu=true, InferenceSession available');
          log.debug('modelPath=%s', cfg.embeddings.modelPath);
          log.debug('LD_LIBRARY_PATH=%s', process.env.LD_LIBRARY_PATH);
        }
        // Native ORT (onnxruntime-node): pass filesystem path. Try CUDA, then CPU fallback.
        modelSource = cfg.embeddings.modelPath;
        // Determine EP order: env override -> default [cuda,cpu]
        const envEps = (process.env.ONNXRUNTIME_NODE_EXECUTION_PROVIDERS || '')
          .split(',')
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean);
        const epOrder = envEps.length ? envEps : ['cuda', 'cpu'];
        if (DEBUG) {
          log.debug('EP order = %s', epOrder.join(','));
        }
        // Safe CUDA probe: try to initialize CUDA EP in a child process to avoid crashing the main process
        // If the probe fails (non-zero exit or segfault), we will skip CUDA and try CPU.
        const probeCuda = async (modelPath: string): Promise<boolean> => {
          try {
            // Allow disabling the probe via env
            if (process.env.ORT_SAFE_CUDA_PROBE === '0') return true;
            const { spawnSync } = await import('node:child_process');
            const node = process.execPath;
            const script = [
              '(async () => {',
              '  try {',
              "    const ort = require('onnxruntime-node');",
              `    const s = await ort.InferenceSession.create(${JSON.stringify(modelPath)}, { executionProviders: [{ name: 'cuda', deviceId: 0 }], graphOptimizationLevel: 'all' });`,
              "    if (!s) throw new Error('no session');",
              "    console.log('CUDA_PROBE_OK');",
              '    process.exit(0);',
              '  } catch (e) {',
              "    console.error('CUDA_PROBE_ERR:', (e && e.message) ? e.message : String(e));",
              '    process.exit(2);',
              '  }',
              '})();'
            ].join('\n');
            const res = spawnSync(node, ['-e', script], { env: process.env, stdio: 'pipe' });
            if (res.signal) {
              if (DEBUG) log.debug('CUDA probe crashed with signal: %s', res.signal);
              return false;
            }
            if (res.status !== 0) {
              if (DEBUG) log.debug('CUDA probe exited with code: %s, stderr: %s', res.status, res.stderr?.toString?.());
              return false;
            }
            return true;
          } catch (e: unknown) {
            if (DEBUG) log.debug('CUDA probe exception: %s', e instanceof Error ? e.message : String(e));
            return false;
          }
        };
        const errs: string[] = [];
        for (const ep of epOrder) {
          try {
            if (DEBUG) log.debug('trying EP=%s with modelSource=path', ep);
            if (ep === 'cuda') {
              // Be explicit about device selection for CUDA EP
              const ok = await probeCuda(modelSource as string);
              if (!ok) throw new Error('CUDA probe failed');
              createOpts.executionProviders = [{ name: 'cuda', deviceId: 0 } as ExecutionProviderConfig];
              if (DEBUG) log.debug('CUDA EP options: %j', createOpts.executionProviders[0]);
            } else {
              createOpts.executionProviders = [ep];
            }
            this.session = await ort.InferenceSession.create(modelSource, createOpts);
            if (DEBUG) log.debug('EP=%s init OK', ep);
            break;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            errs.push(`[${ep}] ${msg}`);
            if (DEBUG) log.debug('EP=%s failed: %s', ep, msg);
          }
        }
        if (!this.session) {
          throw new Error(`no available backend found. ERR: ${errs.join(', ')}`);
        }
      } else {
        // WASM (onnxruntime-web) expects Uint8Array/ArrayBuffer
        if (DEBUG) {
          log.debug('init: useGpu=false or InferenceSession missing, using onnxruntime-web');
          log.debug('modelPath=%s', cfg.embeddings.modelPath);
        }
        modelSource = await fsp.readFile(cfg.embeddings.modelPath);
        this.session = await ort.InferenceSession.create(modelSource, createOpts);
      }
      if (useGpu) {
        try {
          const providers = (this.session as unknown as Record<string, unknown>)?.executionProvider ?? ortModule?.env;
          log.info('ORT backend: onnxruntime-node with providers %j', providers || ['CUDAExecutionProvider','CPUExecutionProvider']);
        } catch {}
      } else {
        log.info('ORT backend: onnxruntime-web (WASM/CPU)');
      }
      if (!this.session) { this.ready = false; return; }

      // Load tokenizer using @xenova/transformers from local filesystem
      {
        const { env, AutoTokenizer } = xenova;
        // Enable local FS loading and block remote fetches
        try { env.useFS = true; } catch {}
        try { env.allowLocalModels = true; } catch {}
        try { env.allowRemoteModels = false; } catch {}
        try { env.localModelPath = '/app'; } catch {}
        try { env.HF_ENDPOINT = ''; } catch {}
        if (DEBUG) {
          log.debug('xenova env: %j', {
            useFS: env.useFS,
            allowLocalModels: env.allowLocalModels,
            allowRemoteModels: env.allowRemoteModels,
            localModelPath: env.localModelPath,
            HF_ENDPOINT: env.HF_ENDPOINT,
          });
        }

        // Prefer repo-like local IDs so xenova resolves under env.localModelPath
        // CWD is /app, so 'models' should resolve to /app/models
        const candidates = ['models'];

        let lastErr: unknown = undefined;
        for (const p of candidates) {
          try {
            this.tokenizer = await AutoTokenizer.from_pretrained(p, { local_files_only: true });
            log.info('Tokenizer ready (@xenova) from %s', p);
            lastErr = undefined;
            break;
          } catch (e: unknown) {
            lastErr = e;
            if (DEBUG) {
              log.debug('Tokenizer load attempt failed for %s: %s', p, e instanceof Error ? e.message : String(e));
            }
          }
        }

        if (!this.tokenizer) {
          log.error('Tokenizer init failed (@xenova)');
          throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr))) ?? new Error('Tokenizer not found');
        }
      }

      this.tokenizerKind = 'xenova';

      // Build batched encoder
      const encodeBatch = async (texts: string[]): Promise<Float32Array[]> => {
        if (!texts.length) return [];
        // Prepare ids/masks depending on tokenizer kind
        let batch = texts.length;
        const seqLen = this.maxLen;
        // Prepare int64 inputs (BigInt64Array) as required by ORT for BERT-like models
        const inputIds = new BigInt64Array(batch * seqLen);
        const attnMask = new BigInt64Array(batch * seqLen);
        const tokenType = new BigInt64Array(batch * seqLen); // zeros

        if (this.tokenizerKind === 'hf-tokenizers') {
          const hfTokenizer = this.tokenizer as unknown as { encodeBatch(texts: string[]): Promise<Array<{ ids: number[]; attention_mask: number[] }>> };
          const enc = await hfTokenizer.encodeBatch(texts);
          batch = enc.length;
          for (let b = 0; b < batch; b++) {
            const ids: number[] = enc[b].ids.slice(0, seqLen);
            const mask: number[] = Array(ids.length).fill(1);
            while (ids.length < seqLen) ids.push(0);
            while (mask.length < seqLen) mask.push(0);
            const offset = b * seqLen;
            for (let t = 0; t < seqLen; t++) {
              inputIds[offset + t] = BigInt(ids[t]);
              attnMask[offset + t] = BigInt(mask[t]);
              tokenType[offset + t] = 0n;
            }
          }
        } else {
          // xenova: encode one-by-one
          for (let b = 0; b < batch; b++) {
            const raw = texts[b];
            const text = typeof raw === 'string' ? raw : String(raw ?? '');
            if (process.env.DEBUG_VECTOR && typeof raw !== 'string') {
              log.debug({ type: typeof raw, value: raw }, 'non-string text passed to tokenizer');
            }
            // Prefer the call form: tokenizer(text, options)
            const encodeOpts: TokenizerEncodeOptions = { add_special_tokens: true };
            const out: TokenizerOutput = await this.tokenizer(text, encodeOpts);
            if (!out?.input_ids || !out?.attention_mask) {
              if (process.env.DEBUG_VECTOR) {
                log.debug({ keys: out ? Object.keys(out) : [] }, 'tokenizer output missing fields');
              }
            }
            const ids: number[] = toNumberArray(out.input_ids).slice(0, seqLen);
            const mask: number[] = toNumberArray(out.attention_mask).slice(0, seqLen);
            if (process.env.DEBUG_VECTOR) {
              if (ids.some((v) => Number.isNaN(v))) log.debug('ids contain NaN after normalization');
              if (mask.some((v) => Number.isNaN(v))) log.debug('mask contain NaN after normalization');
            }
            while (ids.length < seqLen) ids.push(0);
            while (mask.length < seqLen) mask.push(0);
            const offset = b * seqLen;
            for (let t = 0; t < seqLen; t++) {
              inputIds[offset + t] = BigInt(ids[t]);
              attnMask[offset + t] = BigInt(mask[t]);
              tokenType[offset + t] = 0n;
            }
          }
        }

        const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
        const ortTensor = (dtype: string, data: ArrayLike<unknown> | ArrayBuffer, dims: number[]) => new this.ortTensorCtor(dtype, data, dims);
        const inputNames: string[] = this.session.inputNames ?? ['input_ids', 'attention_mask', 'token_type_ids'];
        // Map common names
        if (inputNames.includes('input_ids')) feeds['input_ids'] = ortTensor('int64', inputIds, [batch, seqLen]);
        if (inputNames.includes('attention_mask')) feeds['attention_mask'] = ortTensor('int64', attnMask, [batch, seqLen]);
        if (inputNames.includes('token_type_ids')) feeds['token_type_ids'] = ortTensor('int64', tokenType, [batch, seqLen]);

        const out = await this.session.run(feeds);
        // Pick first output
        const outName = this.session.outputNames?.[0] ?? Object.keys(out)[0];
        const tensor = out[outName];
        const data: Float32Array = tensor.data as Float32Array; // shape [B, S, H]
        const [B, S, H] = tensor.dims as [number, number, number];
        const result: Float32Array[] = [];

        // Mean pooling with attention mask, then L2 normalize
        for (let b = 0; b < B; b++) {
          const vec = new Float32Array(H);
          let count = 0;
          const maskOffset = b * S;
          for (let s = 0; s < S; s++) {
            const m = Number(attnMask[maskOffset + s]);
            if (m === 0) continue;
            count += 1;
            const base = (b * S + s) * H;
            for (let h = 0; h < H; h++) vec[h] += data[base + h];
          }
          const denom = count > 0 ? count : 1;
          let norm = 0;
          for (let h = 0; h < H; h++) { vec[h] /= denom; norm += vec[h] * vec[h]; }
          norm = Math.sqrt(norm) || 1;
          for (let h = 0; h < H; h++) vec[h] /= norm;
          result.push(vec);
        }
        return result;
      };

      this.encodeBatch = encodeBatch;
      this.encodeText = async (text: string) => (await encodeBatch([text]))[0];
      // Initialize embeddings cache
      this.cache = new EmbeddingsCache(this.dim);
      this.ready = true;
    } catch (e: unknown) {
      log.warn('ONNX adapter init failed: %s', e instanceof Error ? e.message : String(e));
      this.ready = false;
    }
  }

  async search(query: string, items: Array<{ id: string; text: string; item: T }>, opts?: { limit?: number }): Promise<SearchResult<T>[]> {
    if (!this.ready) return [];
    try {
      const q = await this.encodeText(query);
      const scored: Array<SearchResult<T>> = [];
      const cfg = loadConfig();
      const batchSize = Math.max(1, Number(cfg.embeddings.batchSize ?? 16));
      const cache = this.cache;

      // Try to fetch vectors from cache; collect misses
      const vecById = new Map<string, Float32Array>();
      const misses: { id: string; text: string; item: T; hash: string }[] = [];
      for (const it of items) {
        if (cache) {
          const h = cache.textHash(it.text);
          const v = await cache.get(it.id, h);
          if (v) {
            vecById.set(it.id, v);
            continue;
          }
          misses.push({ id: it.id, text: it.text, item: it.item, hash: h });
        } else {
          // no cache configured
          misses.push({ id: it.id, text: it.text, item: it.item, hash: '' });
        }
      }

      // Encode misses in batches and populate cache
      for (let i = 0; i < misses.length; i += batchSize) {
        const slice = misses.slice(i, i + batchSize);
        const vecs = await this.encodeBatch(slice.map(s => s.text));
        for (let j = 0; j < slice.length; j++) {
          const id = slice[j].id;
          const v = vecs[j];
          vecById.set(id, v);
          if (cache && slice[j].hash) {
            // fire-and-forget; persist is async but we await to avoid races in tests
            await cache.set(id, slice[j].hash, v);
          }
        }
      }

      // Score all items using available vectors
      for (const it of items) {
        const v = vecById.get(it.id);
        if (!v) continue;
        const score = cosine(q, v);
        scored.push({ id: it.id, score, item: it.item });
      }
      const limit = opts?.limit ?? 20;
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch {
      return [];
    }
  }
}

export async function getVectorAdapter<T>(): Promise<VectorSearchAdapter<T> | undefined> {
  const cfg = loadConfig();
  if (cfg.embeddings.mode === 'none') return undefined;
  if (!cfg.embeddings.dim || !cfg.embeddings.modelPath) return undefined;
  const adapter = new OnnxVectorAdapter<T>(cfg.embeddings.dim);
  await adapter.init();
  if ((adapter as unknown as { ready: boolean }).ready) return adapter;
  return undefined;
}
