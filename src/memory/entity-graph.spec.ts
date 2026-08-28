/**
 * memory/entity-graph.spec.ts — Tests for EntityGraph (MEM-002).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EntityGraph } from './entity-graph.js';

let testDir: string;
let graph: EntityGraph;

describe('MEM-002: EntityGraph', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `entity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    graph = new EntityGraph({ storagePath: join(testDir, '.memory') });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('nodes', () => {
    it('adds and retrieves nodes', () => {
      const node = graph.addNode({ id: 'src/a.ts', type: 'file', name: 'src/a.ts' });
      expect(node.type).toBe('file');
      expect(graph.getNode('src/a.ts')?.id).toBe('src/a.ts');
      expect(graph.count).toBe(1);
    });

    it('is idempotent on duplicate ids', () => {
      graph.addNode({ id: 'x', type: 'file', name: 'x' });
      const second = graph.addNode({ id: 'x', type: 'module', name: 'x' });
      expect(second.type).toBe('file');
      expect(graph.count).toBe(1);
    });

    it('removes a node with its incident edges', () => {
      graph.registerFile('a.ts');
      graph.registerFile('b.ts');
      graph.addImport('a.ts', 'b.ts');
      expect(graph.removeNode('a.ts')).toBe(true);
      expect(graph.getDependents('b.ts')).toEqual([]);
      expect(graph.removeNode('nope')).toBe(false);
    });
  });

  describe('edges', () => {
    it('adds import edges and lists neighbors', () => {
      graph.registerFile('a.ts');
      graph.registerFile('b.ts');
      graph.addImport('a.ts', 'b.ts');

      expect(graph.getDependencies('a.ts').map((n) => n.id)).toEqual(['b.ts']);
      expect(graph.getDependents('b.ts').map((n) => n.id)).toEqual(['a.ts']);
    });

    it('throws when an edge references a missing node', () => {
      expect(() => graph.addEdge({ from: 'a.ts', to: 'b.ts', type: 'imports' })).toThrow(/missing node/);
    });

    it('registerDependency links file → module → dependency', () => {
      graph.registerDependency('src/main.ts', 'lodash', '4.17.21');
      const deps = graph.getDependencies('src/main.ts');
      expect(deps.map((n) => n.id)).toEqual(['dep:lodash', 'module:lodash']);
      const module = graph.getNode('module:lodash')!;
      expect(graph.getDependencies(module.id)[0].id).toBe('dep:lodash');
    });
  });

  describe('findPath() / subgraph()', () => {
    it('finds the shortest path (BFS)', () => {
      graph.addNode({ id: 'a', type: 'file', name: 'a' });
      graph.addNode({ id: 'b', type: 'file', name: 'b' });
      graph.addNode({ id: 'c', type: 'file', name: 'c' });
      graph.addNode({ id: 'd', type: 'file', name: 'd' });
      graph.addEdge({ from: 'a', to: 'b', type: 'imports' });
      graph.addEdge({ from: 'b', to: 'c', type: 'imports' });
      graph.addEdge({ from: 'a', to: 'd', type: 'imports' });
      graph.addEdge({ from: 'd', to: 'c', type: 'imports' });

      const path = graph.findPath('a', 'c')!;
      expect(path.length).toBe(2);
      expect(path.nodes[0]).toBe('a');
      expect(path.nodes[2]).toBe('c');
      expect(path.nodes[1]).toBeOneOf(['b', 'd']);
    });

    it('returns null when no path exists', () => {
      graph.addNode({ id: 'a', type: 'file', name: 'a' });
      graph.addNode({ id: 'b', type: 'file', name: 'b' });
      expect(graph.findPath('a', 'b')).toBeNull();
    });

    it('builds a subgraph around a node', () => {
      graph.addNode({ id: 'a', type: 'file', name: 'a' });
      graph.addNode({ id: 'b', type: 'file', name: 'b' });
      graph.addNode({ id: 'c', type: 'file', name: 'c' });
      graph.addEdge({ from: 'a', to: 'b', type: 'imports' });
      graph.addEdge({ from: 'b', to: 'c', type: 'imports' });

      const near = graph.subgraph('a', 1).map((n) => n.id);
      expect(near).toContain('a');
      expect(near).toContain('b');
      expect(near).not.toContain('c');
    });
  });

  describe('search()', () => {
    it('ranks exact matches above partial matches', () => {
      graph.registerFile('src/auth/auth-service.ts');
      graph.registerFile('src/utils/auth.ts');

      const hits = graph.search('auth');
      expect(hits[0].node.id).toBe('src/utils/auth.ts');
      expect(hits[0].score).toBeGreaterThan(hits[1].score);
    });

    it('matches by basename', () => {
      graph.registerFile('src/lib/logger.ts');
      const hits = graph.search('logger');
      expect(hits.length).toBeGreaterThan(0);
    });
  });

  describe('discoverDir()', () => {
    it('discovers files, relative imports, and package dependencies', () => {
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'main.ts'), [
        "import { helper } from './helper';",
        "import { data } from '../shared/data';",
        "import _ from 'lodash';",
        "import { z } from 'zod';",
        "const x = require('express');",
      ].join('\n'));
      writeFileSync(join(testDir, 'src', 'helper.ts'), "export const helper = 1;\n");
      mkdirSync(join(testDir, 'shared'), { recursive: true });
      writeFileSync(join(testDir, 'shared', 'data.ts'), "export const data = 1;\n");

      const result = graph.discoverDir(testDir);
      expect(result.filesScanned).toBe(3);
      expect(result.filesAdded).toBe(3);
      expect(result.dependenciesFound).toBe(3); // lodash, zod, express

      expect(graph.getNode('src/main.ts')).toBeDefined();
      expect(graph.getNode('src/helper.ts')).toBeDefined();
      expect(graph.getNode('shared/data.ts')).toBeDefined();
      expect(graph.getDependencies('src/main.ts').map((n) => n.id)).toEqual(
        expect.arrayContaining(['src/helper.ts', 'shared/data.ts', 'dep:lodash', 'dep:zod', 'dep:express']),
      );
    });

    it('is idempotent on repeated discovery', () => {
      writeFileSync(join(testDir, 'a.ts'), "import './b';\n");
      writeFileSync(join(testDir, 'b.ts'), "export const b = 1;\n");

      graph.discoverDir(testDir);
      const stats = graph.getStats();
      graph.discoverDir(testDir);
      const stats2 = graph.getStats();
      expect(stats2.nodes).toBe(stats.nodes);
      expect(stats2.edges).toBe(stats.edges);
    });
  });

  describe('persistence & stats', () => {
    it('persists across instances sharing storage', () => {
      graph.registerFile('a.ts');
      graph.registerFile('b.ts');
      graph.addImport('a.ts', 'b.ts');

      const other = new EntityGraph({ storagePath: join(testDir, '.memory') });
      expect(other.count).toBe(2);
      expect(other.getDependencies('a.ts')).toHaveLength(1);
    });

    it('reports stats by type and edge type', () => {
      graph.registerFile('a.ts');
      graph.registerDependency('a.ts', 'lodash');

      const stats = graph.getStats();
      expect(stats.nodes).toBe(3);
      expect(stats.byType.file).toBe(1);
      expect(stats.byType.module).toBe(1);
      expect(stats.byType.dependency).toBe(1);
      expect(stats.byEdgeType.imports).toBe(1);
      expect(stats.byEdgeType.belongsTo).toBe(1);
      expect(stats.byEdgeType.dependsOn).toBe(1);
    });
  });
});
