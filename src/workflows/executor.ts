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
import type { WorkflowStateStore, WorkflowRunState, RunStatus } from './state-store.js';
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
  /** Subflow chain (workflow IDs) — depth/cycle protection (WF-006). */
  subflowStack: string[];
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
  /** Resolver for subflow workflows (WF-006). */
  subflowResolver?: (workflowId: string) => Workflow | undefined;
  /** Max subflow nesting depth. Default: 5. */
  maxSubflowDepth?: number;
}

export interface ExecuteOptions {
  /** State store for checkpoints (WF-005). */
  stateStore?: WorkflowStateStore;
  /** Run ID (generated when omitted). */
  runId?: string;
  /** Session linkage. */
  sessionId?: string;
  /** Resume from the stored state, skipping completed nodes. */
  resume?: boolean;
  /** Initial variables for the run (subflows receive parent context). */
  variables?: Record<string, unknown>;
  /** Internal: subflow chain for depth/cycle protection (WF-006). */
  subflowStack?: string[];
}

// ─── WorkflowExecutor ─────────────────────────────────────────────

export class WorkflowExecutor {
  private readonly toolInvoker: ToolInvoker;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly continueOnError: boolean;
  private readonly approvalHandler?: ApprovalHandler;
  private readonly subflowResolver?: (workflowId: string) => Workflow | undefined;
  private readonly maxSubflowDepth: number;

  constructor(options: ExecutorOptions) {
    this.toolInvoker = options.toolInvoker;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.continueOnError = options.continueOnError ?? false;
    this.approvalHandler = options.approvalHandler;
    this.subflowResolver = options.subflowResolver;
    this.maxSubflowDepth = options.maxSubflowDepth ?? 5;
  }

  /**
   * Execute a workflow.
   */
  async execute(workflow: Workflow, options?: ExecuteOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const runId = options?.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ctx: ExecutionContext = {
      workflowId: workflow.id,
      results: new Map(),
      variables: { ...(options?.variables ?? {}) },
      aborted: false,
      subflowStack: options?.subflowStack ?? [],
    };
    const allResults: NodeResult[] = [];
    const checkpoint = (status: RunStatus, error?: string): void => {
      if (!options?.stateStore) return;
      const completedNodes: Record<string, NodeResult> = {};
      for (const [nodeId, result] of ctx.results) {
        completedNodes[nodeId] = result;
      }
      const state: WorkflowRunState = {
        runId,
        workflowId: workflow.id,
        sessionId: options?.sessionId,
        status,
        completedNodes,
        variables: { ...ctx.variables },
        executedOrder: allResults.map((r) => r.nodeId),
        startedAt: startTimeIso,
        updatedAt: new Date().toISOString(),
        error,
      };
      options.stateStore.save(state);
    };
    const startTimeIso = new Date(startTime).toISOString();

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

    // Resume support: seed context from the stored run state
    if (options?.resume && options?.stateStore) {
      const prior = options.stateStore.load(runId);
      if (prior) {
        for (const [nodeId, result] of Object.entries(prior.completedNodes)) {
          ctx.results.set(nodeId, result);
          if (result.success && !allResults.some((r) => r.nodeId === nodeId)) {
            allResults.push(result);
          }
        }
        ctx.variables = { ...prior.variables };
        log.info({ runId, skipped: allResults.length }, 'resuming workflow run');
      }
    }

    for (const nodeId of order) {
      if (ctx.aborted) break;

      // Resume: skip nodes that already completed successfully
      const prior = ctx.results.get(nodeId);
      if (prior && prior.success) continue;

      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      // Check condition (if condition node)
      if (node.type === 'condition' && node.condition) {
        const shouldProceed = this.evaluateCondition(node.condition, ctx);
        if (!shouldProceed) {
          const result: NodeResult = { nodeId, success: true, durationMs: 0, retries: 0 };
          ctx.results.set(nodeId, result);
          allResults.push(result);
          checkpoint('running');
          continue;
        }
      }

      const result = await this.executeNode(node, ctx);
      ctx.results.set(nodeId, result);
      allResults.push(result);
      checkpoint('running');

      if (!result.success && !this.continueOnError) {
        const error = `Node ${nodeId} failed: ${result.error}`;
        checkpoint('failed', error);
        return {
          success: false,
          results: allResults,
          durationMs: Date.now() - startTime,
          error,
        };
      }
    }

    checkpoint(ctx.aborted ? 'aborted' : 'completed');
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
        // Subflow node: run a nested workflow (WF-006)
        if (node.type === 'subflow') {
          return await this.executeSubflow(node, ctx, attempt, startTime);
        }

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

  /**
   * Execute a subflow node: resolve and run a nested workflow (WF-006).
   * Parent variables + resolved node args become the subflow's initial variables;
   * the subflow's ExecutionResult is stored in the parent's variables.
   */
  private async executeSubflow(
    node: WorkflowNode,
    ctx: ExecutionContext,
    attempt: number,
    startTime: number,
  ): Promise<NodeResult> {
    const subflowId = node.ref;
    if (!subflowId) {
      throw new Error(`[workflow-executor] subflow node ${node.id} is missing ref (target workflow id)`);
    }
    if (!this.subflowResolver) {
      throw new Error(
        `[workflow-executor] subflow node ${node.id} references ${subflowId} but no subflow resolver configured`,
      );
    }
    if (ctx.subflowStack.length >= this.maxSubflowDepth) {
      throw new Error(
        `[workflow-executor] subflow nesting exceeds max depth ${this.maxSubflowDepth} at ${subflowId}`,
      );
    }
    if (ctx.subflowStack.includes(subflowId) || ctx.subflowStack.includes(ctx.workflowId)) {
      throw new Error(
        `[workflow-executor] subflow cycle detected: ${[...ctx.subflowStack, subflowId].join(' -> ')}`,
      );
    }

    const subflow = this.subflowResolver(subflowId);
    if (!subflow) {
      throw new Error(`[workflow-executor] subflow not found: ${subflowId}`);
    }

    const args = this.resolveArgs(node.args ?? {}, ctx);
    const child = await this.execute(subflow, {
      variables: { ...ctx.variables, ...args },
      subflowStack: [...ctx.subflowStack, ctx.workflowId],
    });

    // Store the subflow result for downstream nodes
    ctx.variables[node.id] = child;
    return {
      nodeId: node.id,
      success: child.success,
      value: child.results,
      error: child.error,
      durationMs: Date.now() - startTime,
      retries: attempt,
    };
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
      if (val === undefined) return '';
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });
  }

  private evaluateCondition(condition: string, ctx: ExecutionContext): boolean {
    const trimmed = condition.trim();
    try {
      // Simple condition evaluation: check if a variable is truthy
      const match = trimmed.match(/^\$\{(\w+)\}$/);
      if (match) {
        return Boolean(ctx.variables[match[1]]);
      }
      // Literals without variables
      if (trimmed === 'true') return true;
      if (trimmed === 'false' || trimmed === '') return false;
      // Safe expression over declared variables only — no code execution.
      // Anything outside the grammar (calls, property access, etc.) throws
      // and the condition is treated as false (PROD-002: replaced new Function).
      return this.evaluateSafeCondition(trimmed, ctx.variables);
    } catch {
      log.warn({ condition }, 'condition evaluation failed');
      return false;
    }
  }

  /**
   * Minimal boolean/comparison evaluator for workflow conditions (PROD-002).
   *
   * Grammar: expr := orExpr; orExpr := andExpr ('||' andExpr)*;
   * andExpr := unary ('&&' unary)*; unary := '!' unary | comparison;
   * comparison := primary (('===' | '!==' | '==' | '!=' | '>=' | '<=' | '>' | '<') primary)?;
   * primary := number | 'quoted string' | true/false/null/undefined | identifier | '(' expr ')'.
   *
   * Identifiers resolve ONLY against the provided variables map (unknown → undefined).
   * No property access, no calls, no assignments — tokenizer rejects everything else.
   */
  private evaluateSafeCondition(expr: string, variables: Record<string, unknown>): boolean {
    const tokens = this.tokenizeCondition(expr);
    const parser = new ConditionParser(tokens, variables);
    const value = parser.parseExpr();
    if (parser.hasMore()) throw new Error('unexpected trailing tokens');
    return Boolean(value);
  }

  private tokenizeCondition(expr: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    const pushOp = (op: string): void => {
      tokens.push(op);
      i += op.length;
    };
    while (i < expr.length) {
      const ch = expr[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        i++;
        continue;
      }
      const rest = expr.slice(i);
      const three = rest.slice(0, 3);
      if (three === '===' || three === '!==') {
        pushOp(three);
        continue;
      }
      const two = rest.slice(0, 2);
      if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '>=' || two === '<=') {
        pushOp(two);
        continue;
      }
      if (ch === '!' || ch === '>' || ch === '<' || ch === '(' || ch === ')') {
        pushOp(ch);
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = expr.indexOf(ch, i + 1);
        if (end === -1) throw new Error('unterminated string literal');
        tokens.push(expr.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      const numMatch = rest.match(/^(-?\d+(\.\d+)?)/);
      if (numMatch) {
        tokens.push(numMatch[1]);
        i += numMatch[1].length;
        continue;
      }
      const idMatch = rest.match(/^[A-Za-z_]\w*/);
      if (idMatch) {
        tokens.push(idMatch[0]);
        i += idMatch[0].length;
        continue;
      }
      throw new Error(`unsupported token at offset ${i}`);
    }
    return tokens;
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

// ─── Safe condition parser (PROD-002) ─────────────────────────────────
// Recursive-descent evaluator for the condition grammar documented on
// evaluateSafeCondition. Variables resolve from a caller-provided map only.
class ConditionParser {
  private pos = 0;

  constructor(
    private readonly tokens: string[],
    private readonly variables: Record<string, unknown>,
  ) {}

  hasMore(): boolean {
    return this.pos < this.tokens.length;
  }

  parseExpr(): unknown {
    let left = this.parseAnd();
    while (this.peek() === '||') {
      this.next();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseUnary();
    while (this.peek() === '&&') {
      this.next();
      const right = this.parseUnary();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.peek() === '!') {
      this.next();
      return !this.parseUnary();
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary();
    const op = this.peek();
    if (op === undefined || !['===', '!==', '==', '!=', '>=', '<=', '>', '<'].includes(op)) {
      return left;
    }
    this.next();
    const right = this.parsePrimary();
    switch (op) {
      case '===':
        return left === right;
      case '!==':
        return left !== right;
      case '==':
        // eslint-disable-next-line eqeqeq
        return left == right;
      case '!=':
        // eslint-disable-next-line eqeqeq
        return left != right;
      case '>=':
        return (left as number) >= (right as number);
      case '<=':
        return (left as number) <= (right as number);
      case '>':
        return (left as number) > (right as number);
      default:
        return (left as number) < (right as number);
    }
  }

  private parsePrimary(): unknown {
    const tok = this.next();
    if (tok === undefined) throw new Error('unexpected end of expression');
    if (tok === '(') {
      const value = this.parseExpr();
      if (this.next() !== ')') throw new Error('missing closing paren');
      return value;
    }
    if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
      return tok.slice(1, -1);
    }
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    if (tok === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
    if (/^[A-Za-z_]\w*$/.test(tok)) {
      // Own properties only — prototype names (constructor, __proto__, …) → undefined.
      return Object.prototype.hasOwnProperty.call(this.variables, tok)
        ? this.variables[tok]
        : undefined;
    }
    throw new Error(`unsupported primary: ${tok}`);
  }

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private next(): string | undefined {
    return this.tokens[this.pos++];
  }
}
