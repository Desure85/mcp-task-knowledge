import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = path.join(REPO, 'extensions', 'opencode');
const DOC = path.join(REPO, 'docs', 'plugins', 'opencode.md');

const PLUGINS = [
  'memory-recall.ts',
  'memory-context.ts',
  'memory-context-v2.ts',
  'memory-dream.ts',
  'memory-extract.ts',
  'memory-profile.ts',
  'memory-sync.ts',
  'session-draft.ts',
];

describe('AA-05: OpenCode suite inventory', () => {
  it('keeps every plugin plus the collector and end-session command in the repository', () => {
    for (const name of PLUGINS) {
      expect(fs.existsSync(path.join(SUITE, name)), name).toBe(true);
    }
    expect(fs.existsSync(path.join(SUITE, 'scripts', 'collect-subagent-drafts.sh'))).toBe(true);
    expect(fs.existsSync(path.join(SUITE, 'commands', 'end-session.md'))).toBe(true);
  });

  it('documents every file and has a discrepancies section', () => {
    const doc = fs.readFileSync(DOC, 'utf8');
    for (const name of [...PLUGINS, 'collect-subagent-drafts.sh', 'end-session.md']) {
      expect(doc, `missing ${name}`).toContain(name);
    }
    expect(doc).toMatch(/## Расхождения и решение/);
    expect(doc).toMatch(/memory-sync\.ts/);
    expect(doc).toMatch(/session-draft\.ts/);
  });

  it('does not keep a second copy of the suite outside the repository', () => {
    // Guard against re-introducing the split: the canonical files must be tracked in this repo, and
    // the suite root must not silently gain a nested duplicate tree.
    const nested = path.join(SUITE, 'extensions', 'opencode');
    expect(fs.existsSync(nested)).toBe(false);
  });
});
