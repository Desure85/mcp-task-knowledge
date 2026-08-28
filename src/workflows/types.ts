/**
 * workflows/types.ts — Workflow types (WF-001).
 */

export type NodeType = 'tool' | 'skill' | 'rule' | 'condition' | 'action' | 'subflow';
export type WorkflowStatus = 'draft' | 'active' | 'disabled' | 'archived';

export interface WorkflowNode {
  /** Unique node ID within the workflow. */
  id: string;
  /** Node type. */
  type: NodeType;
  /** Human-readable label. */
  label: string;
  /** Tool/skill/rule name to invoke. */
  ref?: string;
  /** Input arguments for the node. */
  args?: Record<string, unknown>;
  /** Condition expression (for condition nodes). */
  condition?: string;
  /** Whether this node requires human approval before execution (HITL). */
  requiresApproval?: boolean;
  /** Arbitrary metadata. */
  metadata?: Record<string, unknown>;
}

export interface WorkflowEdge {
  /** Source node ID. */
  from: string;
  /** Target node ID. */
  to: string;
  /** Edge label (e.g., condition branch: 'true'/'false'). */
  label?: string;
  /** Condition expression for conditional edges. */
  condition?: string;
}

export interface Workflow {
  /** Unique workflow ID (slug-based). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description. */
  description: string;
  /** Workflow nodes. */
  nodes: WorkflowNode[];
  /** Workflow edges (dependencies). */
  edges: WorkflowEdge[];
  /** Entry node ID. */
  entryNode: string;
  /** Tags for categorization. */
  tags: string[];
  /** Status. */
  status: WorkflowStatus;
  /** Triggers that start this workflow. */
  triggers: string[];
  /** When the workflow was created (ISO 8601). */
  createdAt: string;
  /** When the workflow was last updated (ISO 8601). */
  updatedAt: string;
}

export interface CreateWorkflowInput {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNode: string;
  tags?: string[];
  triggers?: string[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  entryNode?: string;
  tags?: string[];
  status?: WorkflowStatus;
  triggers?: string[];
}
