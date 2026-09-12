/**
 * tests/cold-start.test.ts — DX-22 cold-start regression guard.
 *
 * Spawns the real server (dist/index.js) over stdio, sends MCP `initialize`,
 * and measures TTFB (time to first byte of the initialize response).
 *
 * Target: <500ms on a warm dev machine. The hard-fail bound is generous
 * (2000ms) so CI variance doesn't flake — the actual value is always logged
 * for observability. Median of N runs is used to smooth outliers.
 *
 * Requires `npm run build` first (dist/index.js must exist). Skipped when
 * dist is absent so unit-only runs don't fail.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const RUNS = 3;
// Generous hard-fail bound — real target is <500ms, but CI machines vary.
// The measured value is logged on every run for trend observability.
const HARD_FAIL_MS = 2000;

interface MeasureResult {
  ttfbMs: number;
}

function measureOnce(): Promise<MeasureResult> {
  return new Promise((resolve, reject) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-coldstart-'));
    const env = {
      ...process.env,
      DATA_DIR: dataDir,
      EMBEDDINGS_MODE: 'none',
      CATALOG_ENABLED: 'false',
    };

    const t0 = performance.now();
    const child = spawn('node', [DIST_ENTRY], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let buf = '';
    let settled = false;

    const cleanup = () => {
      try { child.kill('SIGKILL'); } catch {}
      fs.rmSync(dataDir, { recursive: true, force: true });
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('cold-start: no initialize response within 10s'));
      }
    }, 10_000);

    child.stdout.on('data', (d) => {
      buf += d.toString();
      if (!settled && buf.includes('protocolVersion')) {
        settled = true;
        clearTimeout(timer);
        const ttfbMs = performance.now() - t0;
        cleanup();
        resolve({ ttfbMs });
      }
    });

    child.on('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(e);
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error(`cold-start: server exited early (code ${code}). stdout: ${buf.slice(0, 300)}`));
      }
    });

    // MCP stdio SDK uses newline-delimited JSON.
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'cold-start-test', version: '0' },
      },
    });
    child.stdin.write(initMsg + '\n');
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const distExists = fs.existsSync(DIST_ENTRY);

describe.skipIf(!distExists)('cold-start (DX-22)', () => {
  it(
    `stdio initialize TTFB stays under ${HARD_FAIL_MS}ms (median of ${RUNS})`,
    async () => {
      const results: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const { ttfbMs } = await measureOnce();
        results.push(ttfbMs);
      }
      const med = median(results);
      // Always log for observability — this is the trend signal.
      console.log(
        `[cold-start] TTFB runs: ${results.map((r) => Math.round(r)).join(', ')}ms ` +
          `→ median ${Math.round(med)}ms (target <500ms, hard-fail <${HARD_FAIL_MS}ms)`,
      );
      expect(med).toBeLessThan(HARD_FAIL_MS);
    },
    60_000,
  );
});
