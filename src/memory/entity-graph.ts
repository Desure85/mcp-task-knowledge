/**
 * memory/entity-graph.ts — Entity graph (MEM-002).
 *
 * Graph of project entities — files → modules → dependencies — with
 * semantic search over the graph and auto-discovery from source files.
 *
 * Node types: file, module, dependency.
 * Edges: file→file (import), file→dependency (package import),
 *        file→module (belongsTo), module→module (dependsOn).
 *
 * Auto-discovery parses import/require statements from TS/JS files and
 * resolves relative imports to file nodes, package imports to dependency nodes.
 *
 * Usage:
 *   const graph = new EntityGraph({ storagePath: '.memory' });
 *   graph.registerFile('src/a.ts');
 *   graph.addImport('src/a.ts', 'src/b.ts');
 *   graph.discoverDir('src');
 *   const path = graph.findPath('src/a.ts', 'src/b.ts');
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, basename } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('entity-graph');

// ─── Types ────────────────────────────────────────────────────────

export type EntityType = 'file' | 'module' | 'dependency';
export type EdgeType = 'imports' | 'belongsTo' | 'dependsOn';

export interface EntityNode {
  /** Unique node ID. */
  id: string;
  /** Entity type. */
  type: EntityType;
  /** Display name (file path, package name). */
  name: string;
  /** Extra metadata (file extension, package version...). */
  metadata?: Record<string, unknown>;
  /** When the node was added (ISO 8601). */
  createdAt: string;
}

export interface EntityEdge {
  /** Source node ID. */
  from: string;
  /** Target node ID. */
  to: string;
  /** Edge kind. */
  type: EdgeType;
}

export interface GraphPath {
  /** Node IDs from `from` to `to`. */
  nodes: string[];
  /** Total edge count. */
  length: number;
}

export interface SearchHit {
  node: EntityNode;
  /** Lexical score (higher = better). */
  score: number;
}

export interface DiscoveryResult {
  filesScanned: number;
  filesAdded: number;
  dependenciesFound: number;
  edgesAdded: number;
}

// ─── Storage ──────────────────────────────────────────────────────

interface GraphStorage {
  nodes: Record<string, EntityNode>;
  edges: EntityEdge[];
  version: number;
}

// Source extensions considered during discovery.
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'];

// ─── EntityGraph ──────────────────────────────────────────────────

export class EntityGraph {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: GraphStorage;

  constructor(options?: { storagePath?: string }) {
    this.storagePath = options?.storagePath ?? '.memory';
    this.filePath = join(this.storagePath, 'entity-graph.json');
    this.storage = this.load();
  }

  // ─── Node management ────────────────────────────────────────────

  /**
   * Add a node. Idempotent: returns the existing node when the ID is taken.
   */
  addNode(input: { id: string; type: EntityType; name: string; metadata?: Record<string, unknown> }): EntityNode {
    const existing = this.storage.nodes[input.id];
    if (existing) return existing;

    const node: EntityNode = {
      id: input.id,
      type: input.type,
      name: input.name,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    this.storage.nodes[node.id] = node;
    this.save();
    return node;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): EntityNode | undefined {
    return this.storage.nodes[id];
  }

  /**
   * Remove a node and all incident edges.
   */
  removeNode(id: string): boolean {
    if (!this.storage.nodes[id]) return false;
    delete this.storage.nodes[id];
    this.storage.edges = this.storage.edges.filter((e) => e.from !== id && e.to !== id);
    this.save();
    return true;
  }

  // ─── Edge management ────────────────────────────────────────────

  /**
   * Add an edge. Idempotent per (from, to, type).
   */
  addEdge(input: { from: string; to: string; type: EdgeType }): boolean {
    if (!this.storage.nodes[input.from] || !this.storage.nodes[input.to]) {
      throw new Error(`[entity-graph] cannot add edge — missing node: ${input.from} or ${input.to}`);
    }
    const exists = this.storage.edges.some(
      (e) => e.from === input.from && e.to === input.to && e.type === input.type,
    );
    if (exists) return false;
    this.storage.edges.push({ from: input.from, to: input.to, type: input.type });
    this.save();
    return true;
  }

  /**
   * Outgoing neighbors (what this node depends on).
   */
  getDependencies(id: string, type?: EdgeType): EntityNode[] {
    return this.storage.edges
      .filter((e) => e.from === id && (!type || e.type === type))
      .map((e) => this.storage.nodes[e.to])
      .filter((n): n is EntityNode => Boolean(n));
  }

  /**
   * Incoming neighbors (what depends on this node).
   */
  getDependents(id: string, type?: EdgeType): EntityNode[] {
    return this.storage.edges
      .filter((e) => e.to === id && (!type || e.type === type))
      .map((e) => this.storage.nodes[e.from])
      .filter((n): n is EntityNode => Boolean(n));
  }

  // ─── High-level helpers ─────────────────────────────────────────

  /**
   * Register a file node (creates the file node if missing).
   */
  registerFile(filePath: string): EntityNode {
    const id = this.normalizePath(filePath);
    return this.addNode({ id, type: 'file', name: id, metadata: { ext: extname(id) } });
  }

  /**
   * Add an import edge between two paths (creates missing file nodes).
   */
  addImport(fromPath: string, toPath: string): boolean {
    const from = this.registerFile(fromPath);
    const to = this.registerFile(toPath);
    return this.addEdge({ from: from.id, to: to.id, type: 'imports' });
  }

  /**
   * Link a file to a module (belongsTo) and the module to its dependency (dependsOn).
   */
  registerDependency(filePath: string, packageName: string, version?: string): void {
    const file = this.registerFile(filePath);
    const depId = `dep:${packageName}`;
    this.addNode({ id: depId, type: 'dependency', name: packageName, metadata: version ? { version } : {} });
    this.addEdge({ from: file.id, to: depId, type: 'imports' });

    const moduleId = `module:${packageName}`;
    this.addNode({ id: moduleId, type: 'module', name: packageName });
    this.addEdge({ from: file.id, to: moduleId, type: 'belongsTo' });
    this.addEdge({ from: moduleId, to: depId, type: 'dependsOn' });
  }

  /**
   * Shortest path between two nodes (BFS).
   */
  findPath(fromId: string, toId: string): GraphPath | null {
    if (!this.storage.nodes[fromId] || !this.storage.nodes[toId]) return null;
    if (fromId === toId) return { nodes: [fromId], length: 0 };

    const adj = new Map<string, string[]>();
    for (const edge of this.storage.edges) {
      if (!adj.has(edge.from)) adj.set(edge.from, []);
      adj.get(edge.from)!.push(edge.to);
    }

    const prev = new Map<string, string>();
    const visited = new Set([fromId]);
    const queue: string[] = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adj.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        prev.set(next, current);
        if (next === toId) {
          const nodes: string[] = [toId];
          let cursor = toId;
          while (cursor !== fromId) {
            cursor = prev.get(cursor)!;
            nodes.unshift(cursor);
          }
          return { nodes, length: nodes.length - 1 };
        }
        queue.push(next);
      }
    }
    return null;
  }

  /**
   * Subgraph around a node (BFS up to depth).
   */
  subgraph(id: string, depth = 1): EntityNode[] {
    const result: EntityNode[] = [];
    const seen = new Set<string>();
    let frontier = [id];
    for (let d = 0; d <= depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        const node = this.storage.nodes[nodeId];
        if (node) result.push(node);
        for (const neighbor of this.neighborIds(nodeId)) {
          if (!seen.has(neighbor)) next.push(neighbor);
        }
      }
      frontier = next;
    }
    return result;
  }

  /**
   * Lexical search over node names.
   */
  search(query: string, limit = 10): SearchHit[] {
    const lower = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const node of Object.values(this.storage.nodes)) {
      const name = node.name.toLowerCase();
      if (name === lower) {
        hits.push({ node, score: 100 });
      } else if (name.includes(lower)) {
        hits.push({ node, score: 50 - Math.abs(name.length - lower.length) });
      } else if (basename(name).includes(lower)) {
        hits.push({ node, score: 25 });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ─── Auto-discovery ─────────────────────────────────────────────

  /**
   * Scan a directory: add file nodes, parse imports, resolve relative
   * imports to file nodes and package imports to dependency nodes.
   */
  discoverDir(dir: string): DiscoveryResult {
    const result: DiscoveryResult = { filesScanned: 0, filesAdded: 0, dependenciesFound: 0, edgesAdded: 0 };
    const files = this.walkFiles(dir);
    const absoluteDir = resolve(dir);
    const fileIdsBefore = new Set(
      Object.values(this.storage.nodes).filter((n) => n.type === 'file').map((n) => n.id),
    );

    for (const file of files) {
      result.filesScanned++;
      const relativePath = this.normalizePath(relative(absoluteDir, file));
      const node = this.registerFile(relativePath);

      const imports = this.parseImports(file);
      for (const spec of imports) {
        if (spec.startsWith('.')) {
          const resolved = this.resolveRelative(file, spec, absoluteDir);
          if (resolved) {
            const targetId = this.normalizePath(relative(absoluteDir, resolved));
            this.registerFile(targetId);
            if (this.addEdge({ from: node.id, to: targetId, type: 'imports' })) {
              result.edgesAdded++;
            }
          }
        } else {
          const packageName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
          const depId = `dep:${packageName}`;
          if (!this.storage.nodes[depId]) {
            this.addNode({ id: depId, type: 'dependency', name: packageName });
            result.dependenciesFound++;
          }
          if (this.addEdge({ from: node.id, to: depId, type: 'imports' })) {
            result.edgesAdded++;
          }
        }
      }
    }

    result.filesAdded = Object.values(this.storage.nodes).filter(
      (n) => n.type === 'file' && !fileIdsBefore.has(n.id),
    ).length;
    this.save();
    log.info(result, 'directory discovered');
    return result;
  }

  // ─── Stats ──────────────────────────────────────────────────────

  getStats(): { nodes: number; edges: number; byType: Record<EntityType, number>; byEdgeType: Record<EdgeType, number> } {
    const byType: Record<EntityType, number> = { file: 0, module: 0, dependency: 0 };
    for (const node of Object.values(this.storage.nodes)) {
      byType[node.type]++;
    }
    const byEdgeType: Record<EdgeType, number> = { imports: 0, belongsTo: 0, dependsOn: 0 };
    for (const edge of this.storage.edges) {
      byEdgeType[edge.type]++;
    }
    return { nodes: Object.keys(this.storage.nodes).length, edges: this.storage.edges.length, byType, byEdgeType };
  }

  clear(): void {
    this.storage = { nodes: {}, edges: [], version: 1 };
    this.save();
  }

  get count(): number {
    return Object.keys(this.storage.nodes).length;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private neighborIds(id: string): string[] {
    const ids: string[] = [];
    for (const edge of this.storage.edges) {
      if (edge.from === id) ids.push(edge.to);
      if (edge.to === id) ids.push(edge.from);
    }
    return ids;
  }

  private normalizePath(path: string): string {
    return path.split('\\').join('/');
  }

  private walkFiles(dir: string): string[] {
    const files: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return files;
    }
    for (const entry of entries) {
      if (entry.startsWith('node_modules') || entry.startsWith('.git')) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        files.push(...this.walkFiles(full));
      } else if (SOURCE_EXTS.has(extname(full))) {
        files.push(full);
      }
    }
    return files;
  }

  private parseImports(filePath: string): string[] {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      return [];
    }
    const specs: string[] = [];
    const patterns = [
      /import\s+(?:type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const re of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        specs.push(match[1]);
      }
    }
    return Array.from(new Set(specs));
  }

  private resolveRelative(fromFile: string, spec: string, root: string): string | null {
    const base = dirname(fromFile);
    let candidate = resolve(base, spec);
    for (const ext of RESOLVE_EXTS) {
      const withExt = candidate.endsWith('/') ? candidate.slice(0, -1) + ext : candidate + ext;
      if (existsSync(withExt)) return withExt;
    }
    // directory import: ./dir → ./dir/index.ts
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const indexPath = join(candidate, `index${ext}`);
      if (existsSync(indexPath)) return indexPath;
    }
    return null;
  }

  private load(): GraphStorage {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as GraphStorage;
        return { nodes: data.nodes ?? {}, edges: data.edges ?? [], version: data.version ?? 1 };
      }
    } catch (err) {
      log.warn({ err }, 'failed to load entity graph, starting fresh');
    }
    return { nodes: {}, edges: [], version: 1 };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save entity graph');
    }
  }
}
