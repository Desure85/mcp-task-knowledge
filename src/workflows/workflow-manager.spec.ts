/**
 * workflows/workflow-manager.spec.ts — Tests for WorkflowManager (WF-001).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowManager } from './workflow-manager.js';
import type { WorkflowNode, WorkflowEdge } from './types.js';

let testDir: string;

function simpleNodes(): WorkflowNode[] {
  return [
    { id: 'start', type: 'action', label: 'Start' },
    { id: 'lint', type: 'tool', label: 'Lint', ref: 'eslint' },
    { id: 'test', type: 'tool', label: 'Test', ref: 'vitest' },
  ];
}

function simpleEdges(): WorkflowEdge[] {
  return [
    { from: 'start', to: 'lint' },
    { from: 'lint', to: 'test' },
  ];
}

describe('WF-001: WorkflowManager', () => {
  beforeEach(() => {
    testDir = join(process.cwd(), '.test-tmp', `wf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('create()', () => {
    it('creates a valid workflow DAG', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = mgr.create({
        name: 'code-review',
        description: 'Code review pipeline',
        nodes: simpleNodes(),
        edges: simpleEdges(),
        entryNode: 'start',
      });

      expect(wf.id).toBe('code-review');
      expect(wf.status).toBe('draft');
      expect(wf.nodes.length).toBe(3);
    });

    it('throws on cycle', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(() => mgr.create({
        name: 'cyclic',
        description: 'd',
        nodes: [
          { id: 'a', type: 'action', label: 'A' },
          { id: 'b', type: 'action', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
        entryNode: 'a',
      })).toThrow(/cycle/);
    });

    it('throws on unknown entry node', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(() => mgr.create({
        name: 'bad',
        description: 'd',
        nodes: simpleNodes(),
        edges: simpleEdges(),
        entryNode: 'nonexistent',
      })).toThrow(/entry node/);
    });

    it('throws on duplicate', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(() => mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' })).toThrow();
    });

    it('throws on edge to unknown node', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(() => mgr.create({
        name: 'bad',
        description: 'd',
        nodes: [{ id: 'a', type: 'action', label: 'A' }],
        edges: [{ from: 'a', to: 'unknown' }],
        entryNode: 'a',
      })).toThrow(/unknown node/);
    });
  });

  describe('get()', () => {
    it('retrieves by ID', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.get('test')?.name).toBe('test');
    });

    it('returns undefined for unknown', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(mgr.get('unknown')).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('updates fields', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      const updated = mgr.update(wf.id, { description: 'new desc' });
      expect(updated.description).toBe('new desc');
    });

    it('validates DAG on node/edge update', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(() => mgr.update(wf.id, {
        nodes: [{ id: 'a', type: 'action', label: 'A' }, { id: 'b', type: 'action', label: 'B' }],
        edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
      })).toThrow(/cycle/);
    });

    it('throws for unknown', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(() => mgr.update('unknown', { description: 'x' })).toThrow();
    });
  });

  describe('delete()', () => {
    it('deletes a workflow', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.delete(wf.id)).toBe(true);
      expect(mgr.get(wf.id)).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('lists all workflows', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      mgr.create({ name: 'b', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.list().length).toBe(2);
    });

    it('filters by status', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = mgr.create({ name: 'a', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      mgr.create({ name: 'b', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      mgr.activate(wf.id);
      expect(mgr.list({ status: 'active' }).length).toBe(1);
    });

    it('filters by tag', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start', tags: ['ci'] });
      mgr.create({ name: 'b', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start', tags: ['deploy'] });
      expect(mgr.list({ tag: 'ci' }).length).toBe(1);
    });
  });

  describe('search()', () => {
    it('searches in name', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'code-review', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.search('review').length).toBe(1);
    });

    it('searches in description', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'CI pipeline', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.search('pipeline').length).toBe(1);
    });
  });

  describe('getTopologicalOrder()', () => {
    it('returns nodes in topological order', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      const order = mgr.getTopologicalOrder('test');
      expect(order).not.toBeNull();
      expect(order!.length).toBe(3);
      expect(order![0]).toBe('start');
      expect(order![1]).toBe('lint');
      expect(order![2]).toBe('test');
    });

    it('handles parallel branches', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({
        name: 'parallel',
        description: 'd',
        nodes: [
          { id: 'start', type: 'action', label: 'Start' },
          { id: 'a', type: 'tool', label: 'A', ref: 'tool-a' },
          { id: 'b', type: 'tool', label: 'B', ref: 'tool-b' },
          { id: 'end', type: 'action', label: 'End' },
        ],
        edges: [
          { from: 'start', to: 'a' },
          { from: 'start', to: 'b' },
          { from: 'a', to: 'end' },
          { from: 'b', to: 'end' },
        ],
        entryNode: 'start',
      });
      const order = mgr.getTopologicalOrder('parallel');
      expect(order).not.toBeNull();
      expect(order![0]).toBe('start');
      expect(order!.includes('a')).toBe(true);
      expect(order!.includes('b')).toBe(true);
      expect(order![3]).toBe('end');
    });

    it('returns null for unknown workflow', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      expect(mgr.getTopologicalOrder('unknown')).toBeNull();
    });
  });

  describe('getSuccessors() and getPredecessors()', () => {
    it('returns successors', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.getSuccessors('test', 'start')).toEqual(['lint']);
    });

    it('returns predecessors', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      expect(mgr.getPredecessors('test', 'test')).toEqual(['lint']);
    });
  });

  describe('status management', () => {
    it('activate/disable/archive', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      const wf = mgr.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      mgr.activate(wf.id);
      expect(mgr.get(wf.id)?.status).toBe('active');
      mgr.disable(wf.id);
      expect(mgr.get(wf.id)?.status).toBe('disabled');
      mgr.archive(wf.id);
      expect(mgr.get(wf.id)?.status).toBe('archived');
    });
  });

  describe('persistence', () => {
    it('persists across instances', () => {
      const mgr1 = new WorkflowManager({ storagePath: testDir });
      mgr1.create({ name: 'test', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      const mgr2 = new WorkflowManager({ storagePath: testDir });
      expect(mgr2.count).toBe(1);
    });
  });

  describe('clear()', () => {
    it('clears all workflows', () => {
      const mgr = new WorkflowManager({ storagePath: testDir });
      mgr.create({ name: 'a', description: 'd', nodes: simpleNodes(), edges: simpleEdges(), entryNode: 'start' });
      mgr.clear();
      expect(mgr.count).toBe(0);
    });
  });
});
