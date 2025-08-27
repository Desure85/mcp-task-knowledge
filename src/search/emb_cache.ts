import { loadConfig } from '../config.js';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export interface CacheEntryMeta {
  id: string;
  hash: string;
  dims: number;
  bytes: number;
  file?: string;
}

export class EmbeddingsCache {
  private maxBytes: number;
  private usedBytes = 0;
  private lru = new Map<string, { meta: CacheEntryMeta; vec: Float32Array }>();
  private persist: boolean;
  private dir?: string;
  private dims: number;

  constructor(dims: number) {
    const cfg = loadConfig();
    this.maxBytes = Math.max(8 * 1024 * 1024, (cfg.embeddings.cacheMemLimitMB ?? 128) * 1024 * 1024);
    this.persist = Boolean(cfg.embeddings.persist);
    this.dir = cfg.embeddings.cacheDir || undefined;
    this.dims = dims;
  }

  private key(id: string) { return id; }

  private static hashText(text: string): string {
    // djb2
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h) + text.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  public textHash(text: string): string { return EmbeddingsCache.hashText(text); }

  async get(id: string, expectedHash: string): Promise<Float32Array | undefined> {
    const k = this.key(id);
    const hit = this.lru.get(k);
    if (hit && hit.meta.hash === expectedHash) {
      // refresh LRU
      this.lru.delete(k);
      this.lru.set(k, hit);
      return hit.vec;
    }
    // try disk
    if (this.persist && this.dir) {
      try {
        const file = path.join(this.dir, `${id}.bin`);
        const metaFile = path.join(this.dir, `${id}.json`);
        const metaRaw = await fsp.readFile(metaFile, 'utf8').catch(() => undefined);
        if (!metaRaw) return undefined;
        const meta = JSON.parse(metaRaw) as CacheEntryMeta;
        if (meta.hash !== expectedHash || meta.dims !== this.dims) return undefined;
        const buf = await fsp.readFile(file);
        const vec = new Float32Array(new Uint8Array(buf).buffer);
        this.putToMemory(id, expectedHash, vec, file);
        return vec;
      } catch {}
    }
    return undefined;
  }

  async set(id: string, hash: string, vec: Float32Array): Promise<void> {
    const file = (this.persist && this.dir) ? path.join(this.dir, `${id}.bin`) : undefined;
    if (file) {
      try {
        await fsp.mkdir(this.dir!, { recursive: true });
        await fsp.writeFile(file, Buffer.from(vec.buffer));
        const meta: CacheEntryMeta = { id, hash, dims: this.dims, bytes: vec.byteLength, file };
        await fsp.writeFile(path.join(this.dir!, `${id}.json`), JSON.stringify(meta));
      } catch {}
    }
    this.putToMemory(id, hash, vec, file);
  }

  private putToMemory(id: string, hash: string, vec: Float32Array, file?: string) {
    const k = this.key(id);
    const bytes = vec.byteLength;
    // evict until enough room
    while (this.usedBytes + bytes > this.maxBytes && this.lru.size > 0) {
      const oldestKey = this.lru.keys().next().value as string;
      const oldest = this.lru.get(oldestKey)!;
      this.lru.delete(oldestKey);
      this.usedBytes -= oldest.meta.bytes;
    }
    this.lru.set(k, { meta: { id, hash, dims: this.dims, bytes, file }, vec });
    this.usedBytes += bytes;
  }
}
