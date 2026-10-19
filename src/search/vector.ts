import { type VectorSearchAdapter, type VectorWarmupOptions, type VectorWarmupResult } from './index.js';
import { type SearchResult } from '../types.js';
import { loadConfig } from '../config.js';
import { EmbeddingsCache } from './emb_cache.js';
import { childLogger } from '../core/logger.js';
import { basename, dirname, join } from 'node:path';
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
  async search(_query: string, _items: Array<{ id: string; text: string; item: T }>, _opts?: { limit?: number }): Promise<SearchResult<T>[]> {
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
  // Object with 'data' field; transformers.js Tensors expose data as cpuData
  // (onnxruntime-common >= 1.16 defines `data` as a prototype getter, which its
  // Object.assign-based wrapper does not copy over).
  if (typeof arr === 'object' && arr !== null) {
    const holder = arr as { data?: ArrayLike<number | bigint>; cpuData?: ArrayLike<number | bigint> };
    const raw = holder.data ?? holder.cpuData;
    if (raw !== undefined) return toNumberArray(raw);
  }
  return [];
}

export class OnnxVectorAdapter<T> implements VectorSearchAdapter<T> {
  private ready = false;
  private encodeText!: (text: string) => Promise<Float32Array>;
  private encodeBatch!: (texts: string[]) => Promise<Float32Array[]>;
  private dim: number;
  private maxLen = 256;
  private queryPrefix = '';
  private docPrefix = '';
  private cacheSalt = '';
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
      // Native ORT is preferred for cpu too: onnxruntime-web cannot read external-data
      // models ("encoder.onnx.data") — it fails with `Module.MountedFiles is not available`.
      // WASM stays as a last-resort fallback when the native binding is unavailable.
      const MODE = (process.env.EMBEDDINGS_MODE || '').toLowerCase();
      const useGpu = MODE === 'onnx-gpu' || MODE === 'gpu' || MODE === 'cuda';
      type OrtModule = { InferenceSession: { create(model: ArrayBuffer | Uint8Array | string, options?: SessionCreateOptions): Promise<InferenceSession> }; Tensor: TensorConstructor; env?: XenovaEnv };
      let ortModule: OrtModule | null = await import('onnxruntime-node').catch((): null => null) as OrtModule | null;
      const useNativeOrt = Boolean(ortModule);
      if (!ortModule) {
        log.warn('onnxruntime-node not available; falling back to onnxruntime-web (WASM)');
        ortModule = await import('onnxruntime-web').catch((): null => null) as OrtModule | null;
      }
      if (!ortModule) {
        log.warn('no ORT backend installed; disabling vector adapter');
        this.ready = false;
        return;
      }
      const ort = ortModule; // const for TS narrowing
      this.ortTensorCtor = ort.Tensor;
      const fsp = await import('node:fs/promises');
      const fs = await import('node:fs');
      const DEBUG = (process.env.DEBUG_VECTOR === '1' || process.env.DEBUG_VECTOR === 'true');
      // Use @xenova/transformers (pure JS) with local FS support
      const xenova = await import('@huggingface/transformers').catch((): null => null) as { env: XenovaEnv; AutoTokenizer: { from_pretrained(modelPath: string, options?: Record<string, unknown>): Promise<XenovaTokenizer> } } | null;
      if (!xenova) {
        log.warn('@xenova/transformers not available. Disabling vector adapter');
        this.ready = false;
        return;
      }

      // Apply configured maxLen if provided
      if (cfg.embeddings.maxLen && cfg.embeddings.maxLen > 0) {
        this.maxLen = cfg.embeddings.maxLen;
      }
      // Instruction prefixes (e.g. search_query / search_document) must keep exactly
      // one trailing space so the tokenizer sees the same separator as in training.
      const withSpace = (prefix?: string) => {
        const trimmed = (prefix ?? '').trim();
        return trimmed ? `${trimmed} ` : '';
      };
      this.queryPrefix = withSpace(cfg.embeddings.queryPrefix);
      this.docPrefix = withSpace(cfg.embeddings.docPrefix);
      // Cache entries are keyed by text hash, so the model identity must be part of
      // the key: otherwise switching models silently reuses vectors of the old one.
      const configuredModel = cfg.embeddings.modelPath ?? '';
      try {
        const modelStat = fs.statSync(configuredModel);
        this.cacheSalt = `${basename(configuredModel)}:${modelStat.size}`;
      } catch {
        this.cacheSalt = basename(configuredModel || 'model');
      }

      // Infer maxLen and dim from metadata if present
      try {
        const modelDir = cfg.embeddings.modelPath ? dirname(cfg.embeddings.modelPath) : '/app/models';
        const metaPath = ['metadata.json', 'config.json']
          .map((name) => join(modelDir, name))
          .find((candidate) => fs.existsSync(candidate));
        if (metaPath) {
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
      if (useNativeOrt && ort.InferenceSession) {
        if (DEBUG) {
          log.debug('init: using onnxruntime-node, useGpu=%s', useGpu);
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
        const epOrder = envEps.length ? envEps : useGpu ? ['cuda', 'cpu'] : ['cpu'];
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
      if (useNativeOrt) {
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
        // xenova resolves a model id as <localModelPath>/<id>, so point localModelPath at
        // the parent of the model directory and use that directory's name as the id.
        // This keeps any model folder (models/, models/berta-int8/, ...) loadable.
        const modelDir = dirname(cfg.embeddings.modelPath);
        try { env.localModelPath = dirname(modelDir); } catch {}
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

        // Two common layouts: the tokenizer sits next to the .onnx file, or one level
        // up (e.g. models/<name>/onnx/model.onnx with the tokenizer in models/<name>/).
        const dirs = Array.from(new Set([modelDir, dirname(modelDir)]));
        let lastErr: unknown = undefined;
        for (const dir of dirs) {
          try {
            env.localModelPath = dirname(dir);
            this.tokenizer = await AutoTokenizer.from_pretrained(basename(dir), { local_files_only: true });
            log.info('Tokenizer ready (@huggingface/transformers) from %s', dir);
            lastErr = undefined;
            break;
          } catch (e: unknown) {
            lastErr = e;
            if (DEBUG) log.debug('Tokenizer load attempt failed for %s: %s', dir, e instanceof Error ? e.message : String(e));
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

        const encoded: Array<{ ids: number[]; mask: number[] }> = [];
        if (this.tokenizerKind === 'hf-tokenizers') {
          const hfTokenizer = this.tokenizer as unknown as { encodeBatch(texts: string[]): Promise<Array<{ ids: number[]; attention_mask: number[] }>> };
          const enc = await hfTokenizer.encodeBatch(texts);
          for (const item of enc) {
            const ids = item.ids.slice(0, this.maxLen);
            encoded.push({ ids, mask: Array(ids.length).fill(1) });
          }
        } else {
          for (const raw of texts) {
            const text = typeof raw === 'string' ? raw : String(raw ?? '');
            const out: TokenizerOutput = await this.tokenizer(text, { add_special_tokens: true } as TokenizerEncodeOptions);
            const ids = toNumberArray(out.input_ids).slice(0, this.maxLen);
            const mask = toNumberArray(out.attention_mask).slice(0, this.maxLen);
            encoded.push({ ids, mask });
          }
        }

        // Pad to the longest sequence in the batch, not to maxLen: a short query then
        // costs its own length instead of the full window, which dominates CPU latency.
        const batch = encoded.length;
        const seqLen = Math.max(1, encoded.reduce((max, item) => Math.max(max, item.ids.length), 0));
        const inputIds = new BigInt64Array(batch * seqLen);
        const attnMask = new BigInt64Array(batch * seqLen);
        const tokenType = new BigInt64Array(batch * seqLen);
        for (let b = 0; b < batch; b++) {
          const offset = b * seqLen;
          for (let t = 0; t < seqLen; t++) {
            inputIds[offset + t] = BigInt(encoded[b].ids[t] ?? 0);
            attnMask[offset + t] = BigInt(encoded[b].mask[t] ?? 0);
          }
        }

        const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
        const ortTensor = (dtype: string, data: ArrayLike<unknown> | ArrayBuffer, dims: number[]) => new this.ortTensorCtor(dtype, data, dims);
        const inputNames: string[] = this.session.inputNames ?? ['input_ids', 'attention_mask', 'token_type_ids'];
        if (inputNames.includes('input_ids')) feeds['input_ids'] = ortTensor('int64', inputIds, [batch, seqLen]);
        if (inputNames.includes('attention_mask')) feeds['attention_mask'] = ortTensor('int64', attnMask, [batch, seqLen]);
        if (inputNames.includes('token_type_ids')) feeds['token_type_ids'] = ortTensor('int64', tokenType, [batch, seqLen]);
        // Multimodal encoders (EmbeddingGemma and friends) require the unused modality inputs.
        for (const modality of ['image_features', 'video_features', 'audio_features']) {
          if (inputNames.includes(modality)) feeds[modality] = ortTensor('float32', new Float32Array(0), [0, 512]);
        }

        const out = await this.session.run(feeds);

        // Encoders that pool internally return a ready normalized sentence embedding.
        const embedded = out['sentence_embedding'];
        if (embedded) {
          const [B, H] = embedded.dims as [number, number];
          const data = embedded.data as Float32Array;
          const result: Float32Array[] = [];
          for (let b = 0; b < B; b++) {
            const vec = data.slice(b * H, (b + 1) * H);
            let norm = 0;
            for (let h = 0; h < H; h++) norm += vec[h] * vec[h];
            norm = Math.sqrt(norm) || 1;
            for (let h = 0; h < H; h++) vec[h] /= norm;
            result.push(vec);
          }
          return result;
        }

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

      // Smoke test the chosen backend: some GPU/driver combinations fail on specific
      // ops (cuDNN ReduceL2 on Pascal, for instance). Degrade to CPU instead of
      // leaving the server without a vector channel.
      let warmupVector: Float32Array | undefined;
      try {
        warmupVector = await this.encodeText('warmup');
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        const usedGpu = JSON.stringify(createOpts.executionProviders ?? []).includes('cuda');
        if (!usedGpu) throw e;
        log.warn('GPU inference failed (%s); falling back to CPU', message.slice(0, 200));
        this.session = await ort.InferenceSession.create(modelSource, { ...createOpts, executionProviders: ['cpu'] });
        warmupVector = await this.encodeText('warmup');
      }
      // The real output width wins over any config hint (see config.ts).
      if (warmupVector?.length) this.dim = warmupVector.length;
      // Initialize embeddings cache
      this.cache = new EmbeddingsCache(this.dim);
      this.ready = true;
    } catch (e: unknown) {
      log.warn('ONNX adapter init failed: %s', e instanceof Error ? e.message : String(e));
      this.ready = false;
    }
  }

  /**
   * Encode and cache documents without scoring a query. Same cache keys as
   * search(), so a later search hits the cache instead of encoding in-request.
   */
  async warmup(items: Array<{ id: string; text: string }>, opts?: VectorWarmupOptions): Promise<VectorWarmupResult> {
    const startedAt = Date.now();
    const empty: VectorWarmupResult = { total: items.length, encoded: 0, cached: 0, elapsedMs: 0, budgetExceeded: false };
    if (!this.ready) return empty;

    const budgetMs = Math.max(0, opts?.budgetMs ?? 0);
    const cfg = loadConfig();
    const batchSize = Math.max(1, Number(cfg.embeddings.batchSize ?? 16));
    const cache = this.cache;

    let cached = 0;
    const misses: Array<{ id: string; text: string; hash: string }> = [];
    for (const item of items) {
      if (!cache) {
        misses.push({ id: item.id, text: item.text, hash: '' });
        continue;
      }
      const hash = cache.textHash(`${this.cacheSalt}|${this.docPrefix}${item.text}`);
      const vec = await cache.get(item.id, hash);
      if (vec) {
        cached += 1;
        continue;
      }
      misses.push({ id: item.id, text: item.text, hash });
    }

    let encoded = 0;
    let budgetExceeded = false;
    for (let i = 0; i < misses.length; i += batchSize) {
      if (budgetMs > 0 && Date.now() - startedAt > budgetMs) {
        budgetExceeded = true;
        break;
      }
      const slice = misses.slice(i, i + batchSize);
      const vecs = await this.encodeBatch(slice.map((m) => this.docPrefix + m.text));
      for (let j = 0; j < slice.length; j++) {
        const vec = vecs[j];
        if (cache && slice[j].hash) await cache.set(slice[j].id, slice[j].hash, vec);
        encoded += 1;
      }
    }

    return { total: items.length, encoded, cached, elapsedMs: Date.now() - startedAt, budgetExceeded };
  }

  async search(query: string, items: Array<{ id: string; text: string; item: T }>, opts?: { limit?: number }): Promise<SearchResult<T>[]> {
    if (!this.ready) return [];
    try {
      const q = await this.encodeText(this.queryPrefix + query);
      const scored: Array<SearchResult<T>> = [];
      const cfg = loadConfig();
      const batchSize = Math.max(1, Number(cfg.embeddings.batchSize ?? 16));
      const cache = this.cache;

      // Try to fetch vectors from cache; collect misses
      const vecById = new Map<string, Float32Array>();
      const misses: { id: string; text: string; item: T; hash: string }[] = [];
      for (const it of items) {
        if (cache) {
          const h = cache.textHash(`${this.cacheSalt}|${this.docPrefix}${it.text}`);
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
        const vecs = await this.encodeBatch(slice.map(s => this.docPrefix + s.text));
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
  if (!cfg.embeddings.modelPath) return undefined;
  const adapter = new OnnxVectorAdapter<T>(cfg.embeddings.dim ?? 0);
  await adapter.init();
  if ((adapter as unknown as { ready: boolean }).ready) return adapter;
  return undefined;
}
