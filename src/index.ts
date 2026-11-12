/**
 * mcp-task-knowledge — Entry point
 *
 * Delegates all lifecycle management to AppContainer (T-001).
 * This file is intentionally minimal — all logic lives in:
 *   - src/core/app-container.ts  (lifecycle)
 *   - src/register/setup.ts      (server context)
 *   - src/register/*.ts          (tool/resource registration)
 *   - src/transport/*.ts         (transport adapters)
 */

import { childLogger } from './core/logger.js';
import { ServerLockError } from './storage-lock.js';
import { writeSync } from 'node:fs';

const log = childLogger('main');

// CLI subcommand routing (DX-17, MU-08): `doctor` runs the data-integrity
// scanner, `bridge` runs the stdio→http thin proxy. Anything else — including
// zero args, as MCP clients spawn `node dist/index.js` — boots the normal
// server path. Both subcommands load their modules dynamically: `bridge` must
// work without DATA_DIR, and `./config.js` throws at module load without it.
async function maybeRunCli(): Promise<void> {
  if (process.argv[2] !== 'doctor') return;
  const { runDoctorCli } = await import('./cli/doctor.js');
  const { DATA_DIR, TASKS_DIR, KNOWLEDGE_DIR } = await import('./config.js');
  const path = await import('node:path');
  try {
    const result = await runDoctorCli(process.argv.slice(3), {
      dataDir: DATA_DIR,
      tasksDir: TASKS_DIR,
      knowledgeDir: KNOWLEDGE_DIR,
      projectsMetaDir: path.join(DATA_DIR, 'projects'),
    });
    const out = result.text + '\n';
    if (result.exitCode === 2) process.stderr.write(out);
    else process.stdout.write(out);
    process.exit(result.exitCode);
  } catch (err) {
    process.stderr.write(`doctor: crashed: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const { AppContainer } = await import('./core/app-container.js');
  const app = new AppContainer();
  app.run().catch((err) => {
    if (err instanceof ServerLockError) {
      // stderr to a pipe is asynchronous; process.exit() right after write()
      // truncates the only message that explains the refusal.
      writeSync(2, `${err.code}: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    log.fatal({ err }, 'unhandled error in main()');
    process.exit(1);
  });
}

async function runBridge(): Promise<void> {
  const { runBridgeCli } = await import('./cli/bridge.js');
  await runBridgeCli(process.argv.slice(3));
}

/**
 * SC-02d: `reindex` rebuilds the derived metadata index from files. Like `doctor` it exits
 * before AppContainer exists, so it never boots a server; unlike `doctor` it writes, and it
 * takes the DATA_DIR lock itself (`src/cli/reindex.ts`) so it cannot race a live server.
 */
async function maybeRunReindex(): Promise<void> {
  if (process.argv[2] !== 'reindex') return;
  const { runReindexCli } = await import('./cli/reindex.js');
  const { DATA_DIR, TASKS_DIR, KNOWLEDGE_DIR, resolveStorageIndexMode } = await import('./config.js');
  try {
    const result = await runReindexCli(
      process.argv.slice(3),
      { dataDir: DATA_DIR, tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR },
      { storageIndexMode: resolveStorageIndexMode() },
    );
    const out = result.text + '\n';
    if (result.exitCode === 2) process.stderr.write(out);
    else process.stdout.write(out);
    process.exit(result.exitCode);
  } catch (err) {
    process.stderr.write(`reindex: crashed: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

async function maybeRunSetup(): Promise<void> {
  if (process.argv[2] !== 'setup') return;
  // DX-10: setup runs before DATA_DIR is configured; the module resolves defaults/args itself and
  // only imports config-dependent code after it has chosen the directory.
  const { runSetupCli } = await import('./cli/setup.js');
  try {
    const result = await runSetupCli(process.argv.slice(3));
    if (result.text) {
      if (result.exitCode === 0) process.stdout.write(`${result.text}\n`);
      else process.stderr.write(`${result.text}\n`);
    }
  } catch (err) {
    process.stderr.write(`setup: crashed: ${(err as Error).message}\n`);
    process.exit(2);
  }
}

async function maybeRunInstallAgent(): Promise<void> {
  if (process.argv[2] !== 'install-agent') return;
  // AA-07: the installer must run before DATA_DIR is configured and never shells out.
  const { runInstallAgentCli } = await import('./cli/install-agent.js');
  await runInstallAgentCli(process.argv.slice(3));
}

if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  void import('./cli/help-config.js').then((m) => { m.runHelp(); process.exit(0); });
} else if (process.argv[2] === 'config' && process.argv[3] === 'show') {
  void import('./cli/help-config.js').then(async (m) => { process.exit(await m.runConfigShow()); });
} else if (process.argv[2] === 'init') {
  void import('./cli/init-demo.js').then(async (m) => { process.exit(await m.runInitCli(process.argv.slice(3))); });
} else if (process.argv[2] === 'doctor') {
  void maybeRunCli();
} else if (process.argv[2] === 'reindex') {
  void maybeRunReindex();
} else if (process.argv[2] === 'setup') {
  void maybeRunSetup();
} else if (process.argv[2] === 'install-agent') {
  void maybeRunInstallAgent();
} else if (process.argv[2] === 'bridge') {
  void runBridge();
} else {
  void main();
}
