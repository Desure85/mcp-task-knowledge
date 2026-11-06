/**
 * tests/support/orphan-guard.ts — vitest global teardown that fails the run
 * when a suite leaked `node dist/index.js` processes with cwd = project root.
 *
 * The baseline snapshot keeps a manually started dev server (running before
 * the suite) from failing unrelated test runs; anything new that survives the
 * run is a leak and is reported with PID and listening ports.
 */

import { listServerProcesses, type ServerProcess } from './server-process.js';

let baseline = new Set<number>();

export async function setup(): Promise<void> {
  baseline = new Set(listServerProcesses().map((p) => p.pid));
}

function describe(processes: ServerProcess[]): string {
  return processes
    .map((p) => {
      const ports = p.ports.length > 0 ? p.ports.join(',') : 'none';
      return `pid=${p.pid} ppid=${p.ppid} ports=${ports}`;
    })
    .join('; ');
}

export async function teardown(): Promise<void> {
  const all = listServerProcesses();
  const leaked = all.filter((p) => !baseline.has(p.pid));
  if (leaked.length === 0) return;

  throw new Error(
    `[orphan-guard] ${leaked.length} orphaned server process(es) survived the test run ` +
      `(cwd=${process.cwd()}): ${describe(leaked)}. ` +
      'Every spawn must be terminated before the suite ends: use ' +
      'tests/support/server-process.ts (spawnTrackedServer + terminateServer) instead of a bare ' +
      'child.kill("SIGTERM") without awaiting the exit.',
  );
}
