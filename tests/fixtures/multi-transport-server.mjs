import { AppContainer } from '../../dist/core/app-container.js';

// AA-02 fixture: one core, two transports, auth off so the test can compare tools/list.
const app = new AppContainer({
  transportType: 'stdio,http',
  port: Number(process.env.MCP_PORT ?? 3001),
  host: '127.0.0.1',
  auth: { requireAuth: false },
});
await app.run();
