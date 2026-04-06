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

const log = childLogger('main');

const app = new AppContainer();

app.run().catch((err) => {
  log.fatal({ err }, 'unhandled error in main()');
  process.exit(1);
});
