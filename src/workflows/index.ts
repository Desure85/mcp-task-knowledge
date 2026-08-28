/**
 * workflows/index.ts — Workflows module exports.
 */

export { WorkflowManager } from './workflow-manager.js';
export type {
  Workflow, CreateWorkflowInput, UpdateWorkflowInput,
  WorkflowNode, WorkflowEdge, NodeType, WorkflowStatus,
} from './types.js';

export { WorkflowExecutor } from './executor.js';
export type {
  ToolInvoker, ExecutionContext, NodeResult, ExecutionResult, ExecutorOptions, ExecuteOptions,
  ApprovalRequest, ApprovalDecision, ApprovalHandler,
} from './executor.js';

export { WorkflowStateStore } from './state-store.js';
export type { WorkflowRunState, RunStatus } from './state-store.js';

export { workflowTemplates, listWorkflowTemplates, getWorkflowTemplate, buildWorkflowFromTemplate, installWorkflowFromTemplate } from './templates.js';
export type { WorkflowTemplate } from './templates.js';
