export interface ScaleViolation {
  op: string;
  reason: string;
  actual?: number;
  baseline?: number;
  cap?: number;
}

export interface ScaleGateResult {
  ok: boolean;
  factor: number;
  violations: ScaleViolation[];
}

export function evaluateGate(
  result: { ok?: boolean; coldStartMs?: number; ops?: Record<string, { status?: string; medianMs?: number }> },
  baseline: { ops?: Record<string, { medianMs?: number }>; coldStartMs?: number; caps?: Record<string, number> },
  opts?: { factor?: number; caps?: Record<string, number> },
): ScaleGateResult;
