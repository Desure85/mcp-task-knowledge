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
