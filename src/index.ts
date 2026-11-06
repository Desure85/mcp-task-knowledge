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

import { AppContainer } from './core/app-container.js';
import { childLogger } from './core/logger.js';
import { ServerLockError } from './storage-lock.js';
import { writeSync } from 'node:fs';

const log = childLogger('main');

// CLI subcommand routing (DX-17): `mcp-task-knowledge doctor ...` runs the
// data-integrity scanner and exits. Anything else — including zero args, as
// MCP clients spawn `node dist/index.js` — boots the normal server path.
// The check is a plain string compare on argv[2] so the default path is
// byte-for-byte identical to before.
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

function main() {
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

if (process.argv[2] === 'doctor') {
  void maybeRunCli();
} else {
  main();
}
