/**
 * workflows/executor.ts — Workflow executor (WF-002).
 *
 * Executes workflow DAGs: sequential, parallel, conditional branching,
 * error recovery, retry logic.
 *
 * Usage:
 *   const exec = new WorkflowExecutor({
 *     toolInvoker: async (name, args) => { ... },
 *   });
 *   const result = await exec.execute(workflow);
 */

import type { Workflow, WorkflowNode } from './types.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('workflow-executor');

// ─── Types ────────────────────────────────────────────────────────

export type ToolInvoker = (name: string, args: Record<string, unknown>) => Promise<unknown>;

// ─── Human-in-the-loop (HITL) ─────────────────────────────────────

export interface ApprovalRequest {
  /** Workflow being executed. */
  workflowId: string;
  /** Node awaiting approval. */
  nodeId: string;
  /** Human-readable node label. */
  nodeLabel: string;
  /** Tool/skill/rule to invoke (if any). */
  ref?: string;
  /** Resolved input arguments for the node. */
  args: Record<string, unknown>;
  /** Retry attempt (0-based). */
  attempt: number;
}

export type ApprovalDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'modify'; args: Record<string, unknown> };

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision;

export interface ExecutionContext {
  /** Workflow being executed. */
  workflowId: string;
  /** Node results keyed by node ID. */
  results: Map<string, NodeResult>;
  /** Variables available to nodes. */
  variables: Record<string, unknown>;
  /** Whether the execution has been aborted. */
  aborted: boolean;
}

export interface NodeResult {
  /** Node ID. */
  nodeId: string;
  /** Whether the node succeeded. */
  success: boolean;
  /** Return value (if success). */
  value?: unknown;
  /** Error message (if failed). */
  error?: string;
  /** Duration in ms. */
  durationMs: number;
  /** Number of retries. */
  retries: number;
}

export interface ExecutionResult {
  /** Whether the overall workflow succeeded. */
  success: boolean;
  /** All node results. */
  results: NodeResult[];
  /** Total duration in ms. */
  durationMs: number;
  /** Error message (if workflow failed). */
  error?: string;
}

export interface ExecutorOptions {
  /** Function to invoke tools/skills. */
  toolInvoker: ToolInvoker;
  /** Max retries per node. Default: 0. */
  maxRetries?: number;
  /** Retry delay in ms. Default: 100. */
  retryDelayMs?: number;
  /** Whether to continue on error. Default: false. */
  continueOnError?: boolean;
  /** Human-in-the-loop handler for nodes with requiresApproval. */
  approvalHandler?: ApprovalHandler;
}

// ─── WorkflowExecutor ─────────────────────────────────────────────

export class WorkflowExecutor {
  private readonly toolInvoker: ToolInvoker;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly continueOnError: boolean;
  private readonly approvalHandler?: ApprovalHandler;

  constructor(options: ExecutorOptions) {
    this.toolInvoker = options.toolInvoker;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.continueOnError = options.continueOnError ?? false;
    this.approvalHandler = options.approvalHandler;
  }

  /**
   * Execute a workflow.
   */
  async execute(workflow: Workflow): Promise<ExecutionResult> {
    const startTime = Date.now();
    const ctx: ExecutionContext = {
      workflowId: workflow.id,
      results: new Map(),
      variables: {},
      aborted: false,
    };

    // Get topological order
    const order = this.getTopologicalOrder(workflow);
    if (!order) {
      return {
        success: false,
        results: [],
        durationMs: Date.now() - startTime,
        error: 'Cannot execute cyclic workflow',
      };
    }

    const allResults: NodeResult[] = [];

    for (const nodeId of order) {
      if (ctx.aborted) break;

      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      // Check condition (if condition node)
      if (node.type === 'condition' && node.condition) {
        const shouldProceed = this.evaluateCondition(node.condition, ctx);
        if (!shouldProceed) {
          const result: NodeResult = { nodeId, success: true, durationMs: 0, retries: 0 };
          ctx.results.set(nodeId, result);
          allResults.push(result);
          continue;
        }
      }

      const result = await this.executeNode(node, ctx);
      ctx.results.set(nodeId, result);
      allResults.push(result);

      if (!result.success && !this.continueOnError) {
        return {
          success: false,
          results: allResults,
          durationMs: Date.now() - startTime,
          error: `Node ${nodeId} failed: ${result.error}`,
        };
      }
    }

    return {
      success: !ctx.aborted,
      results: allResults,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Abort an execution (sets aborted flag in context).
   */
  abort(ctx: ExecutionContext): void {
    ctx.aborted = true;
    log.info({ workflowId: ctx.workflowId }, 'execution aborted');
  }

  // ─── Internal ───────────────────────────────────────────────────

  private async executeNode(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    const startTime = Date.now();
    let lastError: string | undefined;
    let retries = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Human-in-the-loop: pause for approval before executing
        if (node.requiresApproval) {
          const args = this.resolveArgs(node.args ?? {}, ctx);
          const decision = await this.requestApproval(node, ctx, args, attempt);
          if (decision.action === 'reject') {
            return {
              nodeId: node.id,
              success: false,
              error: 'rejected by user',
              durationMs: Date.now() - startTime,
              retries: attempt,
            };
          }
          const approvedArgs = decision.action === 'modify' ? decision.args : args;

          // Action nodes pass through after approval (checkpoint)
          if (node.type === 'action') {
            return { nodeId: node.id, success: true, durationMs: Date.now() - startTime, retries: attempt };
          }

          // Invoke tool/skill/rule with approved args
          if (node.ref) {
            const value = await this.toolInvoker(node.ref, approvedArgs);
            // Store result in variables for downstream nodes
            ctx.variables[node.id] = value;
            return { nodeId: node.id, success: true, value, durationMs: Date.now() - startTime, retries: attempt };
          }

          return { nodeId: node.id, success: true, durationMs: Date.now() - startTime, retries: attempt };
        }

        // Action nodes just pass through
        if (node.type === 'action') {
          return { nodeId: node.id, success: true, durationMs: Date.now() - startTime, retries };
        }

        // Invoke tool/skill/rule
        if (node.ref) {
          const args = this.resolveArgs(node.args ?? {}, ctx);
          const value = await this.toolInvoker(node.ref, args);
          // Store result in variables for downstream nodes
          ctx.variables[node.id] = value;
          return { nodeId: node.id, success: true, value, durationMs: Date.now() - startTime, retries: attempt };
        }

        return { nodeId: node.id, success: true, durationMs: Date.now() - startTime, retries: attempt };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        retries = attempt;
        log.warn({ nodeId: node.id, attempt, error: lastError }, 'node execution failed');
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs);
        }
      }
    }

    return {
      nodeId: node.id,
      success: false,
      error: lastError,
      durationMs: Date.now() - startTime,
      retries,
    };
  }

  private async requestApproval(
    node: WorkflowNode,
    ctx: ExecutionContext,
    args: Record<string, unknown>,
    attempt: number,
  ): Promise<ApprovalDecision> {
    if (!this.approvalHandler) {
      throw new Error(
        `[workflow-executor] node ${node.id} requires approval but no approval handler configured`,
      );
    }
    const request: ApprovalRequest = {
      workflowId: ctx.workflowId,
      nodeId: node.id,
      nodeLabel: node.label,
      ref: node.ref,
      args,
      attempt,
    };
    log.info({ nodeId: node.id, workflowId: ctx.workflowId }, 'awaiting human approval');
    return this.approvalHandler(request);
  }

  private resolveArgs(args: Record<string, unknown>, ctx: ExecutionContext): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        resolved[key] = this.interpolate(value, ctx);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private interpolate(str: string, ctx: ExecutionContext): string {
    return str.replace(/\$\{(\w+)\}/g, (_, name) => {
      const val = ctx.variables[name];
      return val !== undefined ? String(val) : '';
    });
  }

  private evaluateCondition(condition: string, ctx: ExecutionContext): boolean {
    try {
      // Simple condition evaluation: check if a variable is truthy
      const match = condition.match(/^\$\{(\w+)\}$/);
      if (match) {
        return Boolean(ctx.variables[match[1]]);
      }
      // Otherwise, treat as a JS expression (limited eval)
      const fn = new Function('ctx', `with(ctx.variables) { return ${condition}; }`);
      return Boolean(fn(ctx));
    } catch {
      log.warn({ condition }, 'condition evaluation failed');
      return false;
    }
  }

  private getTopologicalOrder(workflow: Workflow): string[] | null {
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of workflow.nodes) {
      adj.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of workflow.edges) {
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

    return order.length === workflow.nodes.length ? order : null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
