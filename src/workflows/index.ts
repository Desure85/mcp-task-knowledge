/**
 * workflows/index.ts — Workflows module exports.
 */

export { WorkflowManager } from './workflow-manager.js';
export type {
  Workflow, CreateWorkflowInput, UpdateWorkflowInput,
  WorkflowNode, WorkflowEdge, NodeType, WorkflowStatus,
} from './types.js';
