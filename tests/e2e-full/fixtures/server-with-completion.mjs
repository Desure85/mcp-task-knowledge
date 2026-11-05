/**
 * AUD-01 test server: the real AppContainer plus a disabled prompt whose
 * argument is completable. SDK >=1.24 installs the completion/complete handler
 * lazily, only when a Completable argument exists; without one the method
 * answers -32601 before the auth gate, so the gate itself cannot be exercised.
 */

import { AppContainer, defaultRegistration } from '../../../dist/core/app-container.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { z } from 'zod/v3';

const app = new AppContainer({
  registerTools: async (ctx) => {
    await defaultRegistration(ctx);
    const anchor = ctx.server.registerPrompt(
      'audcrit_completion_anchor',
      {
        title: 'completion anchor',
        description: 'internal — keeps completion/complete registered',
        argsSchema: { value: completable(z.string(), () => ['probe']) },
      },
      async () => ({ messages: [] }),
    );
    anchor.disable();
  },
});

app.run().catch((err) => {
  console.error(err);
  process.exit(1);
});
