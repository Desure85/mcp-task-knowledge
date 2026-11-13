#!/usr/bin/env node
/**
 * SC-08 — scale benchmark gate.
 *
 * Reads run-scale.mjs JSON and a checked-in baseline, then fails when a median
 * regresses by more than --factor (default 2) or exceeds an absolute cap.
 * This is a nightly CI gate, not part of `npm test`.
 */

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function evaluateGate(result, baseline, opts = {}) {
  const factor = opts.factor ?? 2;
  const caps = { ...(baseline.caps ?? {}), ...(opts.caps ?? {}) };
  const violations = [];
  if (!result || result.ok !== true) {
    violations.push({ op: 'run', reason: 'result.ok is not true' });
    return { ok: false, factor, violations };
  }
  for (const [op, base] of Object.entries(baseline.ops ?? {})) {
    const actual = result.ops?.[op];
    if (!actual || actual.status !== 'ok' || !Number.isFinite(actual.medianMs)) {
      violations.push({ op, reason: 'missing or failed operation', actual: actual?.status });
      continue;
    }
    if (Number.isFinite(base.medianMs) && actual.medianMs > base.medianMs * factor) {
      violations.push({
        op,
        reason: `median ${actual.medianMs} ms > ${factor}x baseline ${base.medianMs} ms`,
        actual: actual.medianMs,
        baseline: base.medianMs,
      });
    }
    if (Number.isFinite(caps[op]) && actual.medianMs > caps[op]) {
      violations.push({ op, reason: `median ${actual.medianMs} ms > cap ${caps[op]} ms`, actual: actual.medianMs, cap: caps[op] });
    }
  }
  if (Number.isFinite(caps.rssAfterLoadMb) && Number.isFinite(result.rssAfterLoadMb) && result.rssAfterLoadMb > caps.rssAfterLoadMb) {
    violations.push({ op: 'rssAfterLoadMb', reason: `${result.rssAfterLoadMb} MB > cap ${caps.rssAfterLoadMb} MB`, actual: result.rssAfterLoadMb, cap: caps.rssAfterLoadMb });
  }
  if (Number.isFinite(caps.coldStartMs) && Number.isFinite(result.coldStartMs) && result.coldStartMs > caps.coldStartMs) {
    violations.push({ op: 'coldStartMs', reason: `${result.coldStartMs} ms > cap ${caps.coldStartMs} ms`, actual: result.coldStartMs, cap: caps.coldStartMs });
  }
  return { ok: violations.length === 0, factor, violations };
}

function parseArgs(argv) {
  const out = { result: '', baseline: 'docs/benchmarks/scale-baseline.json', factor: 2, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--result': out.result = next(); break;
      case '--baseline': out.baseline = next(); break;
      case '--factor': out.factor = Number(next()); break;
      case '--out': out.out = next(); break;
      case '-h':
      case '--help':
        console.log('usage: node scripts/bench/gate-scale.mjs --result <run.json> [--baseline file] [--factor 2] [--out gate.json]');
        process.exit(0);
        break;
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!out.result) throw new Error('--result is required');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [result, baseline] = await Promise.all([
    fs.readFile(args.result, 'utf8').then(JSON.parse),
    fs.readFile(args.baseline, 'utf8').then(JSON.parse),
  ]);
  const gate = evaluateGate(result, baseline, { factor: args.factor });
  const payload = JSON.stringify({ ...gate, result: args.result, baseline: args.baseline }, null, 2);
  if (args.out) await fs.writeFile(args.out, payload + '\n');
  console.log(payload);
  process.exit(gate.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e?.stack || String(e));
    process.exit(2);
  });
}
