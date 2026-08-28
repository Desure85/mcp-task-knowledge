/**
 * core/index.ts — Core module exports (TD-010).
 *
 * Barrel for cross-cutting execution infrastructure: context, executor,
 * middleware pipeline, logging, security, and centralized error handling.
 * Modules may still be imported directly for tree-shaking — this file is a
 * convenience for consumers that need several core pieces at once.
 */

export { createToolContext, ToolExecutor, ToolDeniedError } from './tool-executor.js';
export type {
  ToolContext,
  ToolContextOptions,
  ContextAwareToolHandler,
  RawToolHandler,
  PreToolHook,
  PostToolHook,
  ErrorToolHook,
  PreHookResult,
} from './tool-executor.js';

export { MiddlewareContext, MiddlewarePipeline } from './middleware.js';
export type { ToolMiddleware, BeforeResult } from './middleware.js';

export { createLogger, getRootLogger, childLogger } from './logger.js';

export {
  ErrorCategory,
  ToolError,
  ValidationError,
  NotFoundError,
  PermissionError,
  classifyError,
  toErrorResponse,
  statusCodeFor,
  ErrorHandler,
  createErrorHandlerMiddleware,
} from './error-handler.js';
export type {
  ToolErrorContext,
  ErrorResponse,
  Classification,
  ErrorHandlerOptions,
  ErrorHandlerMeta,
} from './error-handler.js';
