/**
 * behavioral/index.ts — Behavioral memory module exports.
 */

export { IntentCapture } from './intent-capture.js';
export type { IntentRecord, CaptureResult, IntentCaptureOptions } from './intent-capture.js';

export { RuntimeObservation } from './runtime-observation.js';
export type { RuntimeSnapshot, RuntimeObservationOptions } from './runtime-observation.js';

export { FailureLogger } from './failure-logging.js';
export type { FailureRecord, FailureLoggerOptions } from './failure-logging.js';

export { ResolutionLogger } from './resolution-logging.js';
export type { ResolutionRecord, ResolutionLoggerOptions } from './resolution-logging.js';

export { RepairBrief } from './repair-brief.js';
export type { RepairBriefResult, SimilarFix } from './repair-brief.js';

export { CodeLineage } from './code-lineage.js';
export type { LineageNode, LineageResult } from './code-lineage.js';

export { AutoHealWorker } from './auto-heal.js';
export type { RepairPatch, SourceResolution, PatchStatus, AutoHealOptions, TriggerFilter, AutoHealStatus } from './auto-heal.js';

export { GuardrailPredictor } from './guardrail-predictor.js';
export type { GuardPattern, PredictInput, PredictWarning, PredictResult, RiskLevel, GuardrailOptions } from './guardrail-predictor.js';

export { CrossProjectSearch } from './cross-project-search.js';
export type { ProjectMemory, CrossProjectHit, FixSearchOptions } from './cross-project-search.js';

export { GuardRuleLearner } from './guard-rule-learner.js';
export type { LearnResult, LearnerOptions } from './guard-rule-learner.js';
