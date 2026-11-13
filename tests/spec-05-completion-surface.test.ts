import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** SPEC-05: no completion/complete dispatch and no completion capability without a handler. */
describe('SPEC-05 completion surface', () => {
  it('does not intercept completion/complete in either transport dispatch set', () => {
    for (const file of ['src/transport/http-transport.ts', 'src/transport/stream-transport.ts']) {
      const source = read(file);
      const block = /MAIN_DISPATCH_METHODS[\s\S]*?\]\);/.exec(source)?.[0] ?? '';
      expect(block, file).not.toContain('completion/complete');
    }
  });

  it('does not advertise the completion capability', () => {
    const source = read('src/register/setup.ts');
    const caps = /const SERVER_CAPS[\s\S]*?as const;/.exec(source)?.[0] ?? '';
    expect(caps).not.toContain('completion:');
  });
});
