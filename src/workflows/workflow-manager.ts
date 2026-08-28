/**
 * workflows/workflow-manager.ts — Workflow DAG builder (WF-001).
 *
 * Define workflow graphs: nodes (tools/skills/rules/conditions), edges (dependencies),
 * conditions, triggers. Validates DAG (no cycles).
 *
 * Storage: JSON file on disk (default: .workflows/workflows.json)
 *
 * Usage:
 *   const mgr = new WorkflowManager({ storagePath: '.workflows' });
 *   const wf = mgr.create({
 *     name: 'code-review',
 *     description: 'Code review pipeline',
 *     nodes: [
 *       { id: 'start', type: 'action', label: 'Start' },
 *       { id: 'lint', type: 'tool', label: 'Lint', ref: 'eslint' },
 *       { id: 'test', type: 'tool', label: 'Test', ref: 'vitest' },
 *     ],
 *     edges: [
 *       { from: 'start', to: 'lint' },
 *       { from: 'lint', to: 'test' },
 *     ],
 *     entryNode: 'start',
 *   });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { Workflow, CreateWorkflowInput, UpdateWorkflowInput, WorkflowNode, WorkflowEdge, WorkflowStatus } from './types.js';

const log = childLogger('workflow-manager');

// ─── Storage ──────────────────────────────────────────────────────

interface WorkflowStorage {
  workflows: Record<string, Workflow>;
}

// ─── WorkflowManager ──────────────────────────────────────────────

export class WorkflowManager {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: WorkflowStorage;

  constructor(options?: { storagePath?: string }) {
    this.storagePath = options?.storagePath ?? '.workflows';
    this.filePath = join(this.storagePath, 'workflows.json');
    this.storage = this.load();
  }

  /**
   * Create a new workflow. Validates DAG (no cycles).
   */
  create(input: CreateWorkflowInput): Workflow {
    const id = this.slugify(input.name);
    if (this.storage.workflows[id]) {
      throw new Error(`[workflow-manager] workflow already exists: ${id}`);
    }

    // Validate DAG
    this.validateDAG(input.nodes, input.edges);

    // Validate entry node exists
    if (!input.nodes.some((n) => n.id === input.entryNode)) {
      throw new Error(`[workflow-manager] entry node not found: ${input.entryNode}`);
    }

    const now = new Date().toISOString();
    const workflow: Workflow = {
      id,
      name: input.name,
      description: input.description,
      nodes: input.nodes,
      edges: input.edges,
      entryNode: input.entryNode,
      tags: input.tags ?? [],
      status: 'draft',
      triggers: input.triggers ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.storage.workflows[id] = workflow;
    this.save();
    log.info({ id, nodes: input.nodes.length }, 'workflow created');
    return workflow;
  }

  /**
   * Get a workflow by ID.
   */
  get(id: string): Workflow | undefined {
    return this.storage.workflows[id];
  }

  /**
   * Update a workflow.
   */
  update(id: string, input: UpdateWorkflowInput): Workflow {
    const wf = this.storage.workflows[id];
    if (!wf) {
      throw new Error(`[workflow-manager] workflow not found: ${id}`);
    }

    if (input.nodes !== undefined || input.edges !== undefined) {
      const nodes = input.nodes ?? wf.nodes;
      const edges = input.edges ?? wf.edges;
      this.validateDAG(nodes, edges);
      wf.nodes = nodes;
      wf.edges = edges;
    }

    if (input.name !== undefined) wf.name = input.name;
    if (input.description !== undefined) wf.description = input.description;
    if (input.entryNode !== undefined) {
      if (!wf.nodes.some((n) => n.id === input.entryNode)) {
        throw new Error(`[workflow-manager] entry node not found: ${input.entryNode}`);
      }
      wf.entryNode = input.entryNode;
    }
    if (input.tags !== undefined) wf.tags = input.tags;
    if (input.status !== undefined) wf.status = input.status;
    if (input.triggers !== undefined) wf.triggers = input.triggers;
    wf.updatedAt = new Date().toISOString();

    this.save();
    log.info({ id }, 'workflow updated');
    return wf;
  }

  /**
   * Delete a workflow.
   */
  delete(id: string): boolean {
    if (!this.storage.workflows[id]) return false;
    delete this.storage.workflows[id];
    this.save();
    return true;
  }

  /**
   * List workflows, optionally filtered by status or tag.
   */
  list(filter?: { status?: WorkflowStatus; tag?: string }): Workflow[] {
    let wfs = Object.values(this.storage.workflows);
    if (filter?.status) wfs = wfs.filter((w) => w.status === filter.status);
    if (filter?.tag) wfs = wfs.filter((w) => w.tags.includes(filter.tag!));
    return wfs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Search workflows by text in name or description.
   */
  search(query: string): Workflow[] {
    const lower = query.toLowerCase();
    return Object.values(this.storage.workflows).filter(
      (w) => w.name.toLowerCase().includes(lower) || w.description.toLowerCase().includes(lower),
    );
  }

  /**
   * Get the topological order of nodes (execution order).
   */
  getTopologicalOrder(id: string): string[] | null {
    const wf = this.storage.workflows[id];
    if (!wf) return null;

    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of wf.nodes) {
      adj.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of wf.edges) {
      adj.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [node, deg] of inDegree) {
      if (deg === 0) queue.push(node);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const next of adj.get(node) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }

    return order.length === wf.nodes.length ? order : null;
  }

  /**
   * Get successors of a node.
   */
  getSuccessors(id: string, nodeId: string): string[] {
    const wf = this.storage.workflows[id];
    if (!wf) return [];
    return wf.edges.filter((e) => e.from === nodeId).map((e) => e.to);
  }

  /**
   * Get predecessors of a node.
   */
  getPredecessors(id: string, nodeId: string): string[] {
    const wf = this.storage.workflows[id];
    if (!wf) return [];
    return wf.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  }

  activate(id: string): Workflow | undefined {
    return this.setStatus(id, 'active');
  }

  disable(id: string): Workflow | undefined {
    return this.setStatus(id, 'disabled');
  }

  archive(id: string): Workflow | undefined {
    return this.setStatus(id, 'archived');
  }

  get count(): number {
    return Object.keys(this.storage.workflows).length;
  }

  clear(): void {
    this.storage = { workflows: {} };
    this.save();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private setStatus(id: string, status: WorkflowStatus): Workflow | undefined {
    const wf = this.storage.workflows[id];
    if (!wf) return undefined;
    wf.status = status;
    wf.updatedAt = new Date().toISOString();
    this.save();
    return wf;
  }

  /**
   * Validate that the graph is a DAG (no cycles) using DFS.
   */
  private validateDAG(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
    const adj = new Map<string, string[]>();
    for (const node of nodes) adj.set(node.id, []);
    for (const edge of edges) {
      if (!adj.has(edge.from)) throw new Error(`[workflow-manager] edge from unknown node: ${edge.from}`);
      if (!adj.has(edge.to)) throw new Error(`[workflow-manager] edge to unknown node: ${edge.to}`);
      adj.get(edge.from)!.push(edge.to);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const node of nodes) color.set(node.id, WHITE);

    const dfs = (node: string): void => {
      color.set(node, GRAY);
      for (const next of adj.get(node) ?? []) {
        if (color.get(next) === GRAY) {
          throw new Error(`[workflow-manager] cycle detected: ${node} → ${next}`);
        }
        if (color.get(next) === WHITE) dfs(next);
      }
      color.set(node, BLACK);
    };

    for (const node of nodes) {
      if (color.get(node.id) === WHITE) dfs(node.id);
    }
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private load(): WorkflowStorage {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as WorkflowStorage;
      }
    } catch (err) {
      log.warn({ err }, 'failed to load workflows, starting fresh');
    }
    return { workflows: {} };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save workflows');
    }
  }
}
