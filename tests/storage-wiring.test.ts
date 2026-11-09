/**
 * Y-02e1 — the storage profile is part of the server context, and the registrator migration is
 * tracked as an exact allowlist.
 *
 * ADR-009 §«Точка сборки»: modules receive storage from the context instead of importing
 * `src/storage/*` directly. This increment does not switch the registrators yet; it makes the
 * switch *measurable*: the test below pins the exact set of files that still import storage and
 * what they import. Y-02e2 shrinks the set to 7 files, Y-02e3 to zero — growing it fails the test,
 * which is the whole point (otherwise "registrators no longer import storage" stays a claim).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createServerContext } from '../src/register/setup.js';
import { KNOWLEDGE_DIR, TASKS_DIR, getCurrentProject } from '../src/config.js';
import { resolveStoreId } from '../src/search/fts-index.js';
import { registerAliases } from '../src/register/aliases.js';
import { storageProfile } from '../src/core/storage-context.js';

const REGISTER_DIR = path.join(process.cwd(), 'src', 'register');

/**
 * Direct storage imports per registrator file. Y-02e3 state: 1 file (search.ts, see Y-02e4).
 * The list may only shrink.
 */
const EXPECTED_ALLOWLIST: Record<string, string[]> = {
  // Y-02e3 state: only the search registrar still touches storage directly. Its indexes are the
  // Y-03/Y-05 providers, so it moves in Y-02e4 (after the SearchProvider contract lands).
  'search.ts': ['search/fts-indexer.js', 'storage/knowledge.js', 'storage/metadata-index.js', 'storage/tasks.js'],
};

/**
 * `storage/contracts.js` is the contract's own type import — registrators must be allowed to
 * speak in contract types. The allowlist tracks data-access modules only.
 */
const STORAGE_IMPORT =
  /from '\.\.\/(?:storage\/((?!contracts\b)[a-z0-9-]+)\.js|prompts\/files\.js|search\/(fts-indexer|fts-index)\.js)'/g;

function collectStorageImports(): Record<string, string[]> {
  const files = fs.readdirSync(REGISTER_DIR).filter((name) => name.endsWith('.ts'));
  const found: Record<string, string[]> = {};
  for (const file of files) {
    const source = fs.readFileSync(path.join(REGISTER_DIR, file), 'utf8');
    const targets = new Set<string>();
    for (const match of source.matchAll(STORAGE_IMPORT)) {
      if (match[1]) targets.add(`storage/${match[1]}.js`);
      else if (match[2]) targets.add(`search/${match[2]}.js`);
      else targets.add('prompts/files.js');
    }
    if (targets.size > 0) found[file] = [...targets].sort();
  }
  return found;
}

describe('Y-02e1: storage profile in the server context', () => {
  it('publishes the file profile with an honest manifest', async () => {
    const ctx = await createServerContext();

    expect(ctx.storage).toBeDefined();
    const profile = ctx.storage!;
    expect(profile.manifest.profile).toBe('file');
    expect(profile.manifest.collections).toEqual([
      'tasks',
      'docs',
      'projects',
      'prompts',
      'memory',
      'events',
      'history',
      'locks',
    ]);
    expect(profile.manifest.capabilities).toEqual({
      transactions: false,
      history: true,
      fullText: true,
      vectors: true,
      efficientListing: true,
    });
    expect(profile.manifest.roots.tasks).toBe(resolveStoreId(TASKS_DIR));
    expect(profile.manifest.roots.knowledge).toBe(resolveStoreId(KNOWLEDGE_DIR));

    // The profile is wired to real storage, not a stub: an empty DATA_DIR lists nothing.
    expect(await profile.tasks.list()).toEqual([]);
  }, 30_000);

  it('keeps the registrator allowlist exactly as expected (it may only shrink)', () => {
    expect(collectStorageImports()).toEqual(EXPECTED_ALLOWLIST);
  });
});

// Y-02e3: a registrator that claims to read from the profile must actually read from it. Capture
// the SDK handlers that `registerAliases` registers and drive one through a real context, so a
// wiring regression (reading another collection) fails a test instead of hiding in a resource.
describe('Y-02e3: registrators read collections from the profile', () => {
  it('serves tasks://current from the profile', async () => {
    const ctx = await createServerContext();
    const profile = storageProfile(ctx);
    const project = getCurrentProject();
    const task = await profile.tasks.create({ project, title: 'wired task' });

    const captured: Record<string, (uri: { href: string }) => Promise<{ contents: Array<{ text: string }> }>> = {};
    const server = ctx.server as unknown as {
      registerResource: (...args: any[]) => unknown;
      registerResourceTemplate: (...args: any[]) => unknown;
    };
    const originalResource = server.registerResource;
    const originalTemplate = server.registerResourceTemplate;
    server.registerResource = (...args: any[]) => {
      const name = String(args[0]);
      captured[name] = args[args.length - 1] as never;
      return undefined;
    };
    server.registerResourceTemplate = () => undefined;
    try {
      registerAliases(ctx);
    } finally {
      server.registerResource = originalResource;
      server.registerResourceTemplate = originalTemplate;
    }

    const handler = captured['tasks_current'];
    expect(handler).toBeDefined();
    const result = await handler!({ href: 'tasks://current' });
    const items = JSON.parse(result.contents[0].text) as Array<{ id: string; title: string }>;
    expect(items.map((item) => item.id)).toContain(task.id);
    expect(items.map((item) => item.title)).toContain('wired task');

    await profile.tasks.deletePermanent(project, task.id);
  }, 30_000);
});
