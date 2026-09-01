/**
 * memory/layers.ts — Memory Layers (NEXT-017).
 *
 * Three-tier memory scoping: conversation (in-flight), session (run-scoped), user (persistent).
 * Inspired by Mem0/Letta: different retention and visibility per layer.
 *
 * Architecture:
 *   - MemoryLayer enum: conversation, session, user
 *   - LayeredMemory: stores facts per layer with different lifecycle
 *   - Conversation layer: volatile, cleared after session ends
 *   - Session layer: persisted for run duration, cleared after run completes
 *   - User layer: permanent, persisted across sessions
 *   - Integration: memory_extract writes to conversation, /end-session promotes to session, /end-run promotes to user
 *
 * Usage:
 *   const mem = new LayeredMemory({ storagePath: '.memory/layers' });
 *   mem.add('conversation', { statement: 'user asked about auth' });
 *   mem.promote('conversation', 'session', factId);
 *   const facts = mem.getLayer('user');
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { childLogger } from '../core/logger.js';

const log = childLogger('memory-layers');

export type MemoryLayer = 'conversation' | 'session' | 'user';

export interface LayeredFact {
  id: string;
  layer: MemoryLayer;
  statement: string;
  category: string;
  confidence: number;
  tags: string[];
  createdAt: string;
  valid: boolean;
}

export interface LayeredMemoryOptions {
  storagePath: string;
}

interface LayerStorage {
  conversation: Record<string, LayeredFact>;
  session: Record<string, LayeredFact>;
  user: Record<string, LayeredFact>;
  version: number;
}

export class LayeredMemory {
  private storage: LayerStorage;
  private readonly storagePath: string;

  constructor(options: LayeredMemoryOptions) {
    this.storagePath = options.storagePath;
    this.storage = { conversation: {}, session: {}, user: {}, version: 1 };
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        this.storage = JSON.parse(readFileSync(this.storagePath, 'utf-8'));
      }
    } catch (e) {
      log.warn({ error: e }, 'failed to load layered memory — starting fresh');
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(this.storage, null, 2));
    } catch (e) {
      log.error({ error: e }, 'failed to save layered memory');
    }
  }

  private layerMap(layer: MemoryLayer): Record<string, LayeredFact> {
    return this.storage[layer];
  }

  add(layer: MemoryLayer, input: { statement: string; category?: string; confidence?: number; tags?: string[] }): LayeredFact {
    const fact: LayeredFact = {
      id: randomUUID(),
      layer,
      statement: input.statement,
      category: input.category ?? 'fact',
      confidence: input.confidence ?? 0.5,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
      valid: true,
    };
    this.layerMap(layer)[fact.id] = fact;
    this.save();
    log.info({ layer, factId: fact.id }, 'fact added to layer');
    return fact;
  }

  get(layer: MemoryLayer, factId: string): LayeredFact | null {
    return this.layerMap(layer)[factId] ?? null;
  }

  getLayer(layer: MemoryLayer): LayeredFact[] {
    return Object.values(this.layerMap(layer)).filter((f) => f.valid);
  }

  promote(from: MemoryLayer, to: MemoryLayer, factId: string): boolean {
    const fact = this.layerMap(from)[factId];
    if (!fact) return false;

    fact.layer = to;
    delete this.layerMap(from)[factId];
    this.layerMap(to)[factId] = fact;
    this.save();

    log.info({ factId, from, to }, 'fact promoted');
    return true;
  }

  promoteAll(from: MemoryLayer, to: MemoryLayer): number {
    const facts = Object.values(this.layerMap(from));
    let count = 0;
    for (const fact of facts) {
      fact.layer = to;
      delete this.layerMap(from)[fact.id];
      this.layerMap(to)[fact.id] = fact;
      count++;
    }
    this.save();
    log.info({ from, to, count }, 'batch promote');
    return count;
  }

  invalidate(layer: MemoryLayer, factId: string): boolean {
    const fact = this.layerMap(layer)[factId];
    if (!fact) return false;
    fact.valid = false;
    this.save();
    return true;
  }

  clearLayer(layer: MemoryLayer): number {
    const count = Object.keys(this.layerMap(layer)).length;
    this.storage[layer] = {};
    this.save();
    log.info({ layer, count }, 'layer cleared');
    return count;
  }

  stats(): Record<MemoryLayer, { total: number; valid: number }> {
    const result = {} as Record<MemoryLayer, { total: number; valid: number }>;
    for (const layer of ['conversation', 'session', 'user'] as MemoryLayer[]) {
      const facts = Object.values(this.layerMap(layer));
      result[layer] = {
        total: facts.length,
        valid: facts.filter((f) => f.valid).length,
      };
    }
    return result;
  }
}
