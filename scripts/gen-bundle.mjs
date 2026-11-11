#!/usr/bin/env node
/**
 * AA-07 — generate bundle.json from the repository's installable components.
 *
 * Hashes are the source of truth for the installer and for the integrity test.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function sha(file) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

const plugins = [
  'memory-context-v2.ts',
  'memory-context.ts',
  'memory-dream.ts',
  'memory-extract.ts',
  'memory-profile.ts',
  'memory-recall.ts',
  'memory-sync.ts',
  'session-draft.ts',
].map((file, index) => ({
  id: `opencode-${file.replace(/\.ts$/, '').replace(/_/g, '-')}`,
  category: file === 'memory-sync.ts' ? 'sync' : 'plugin',
  version: VERSION,
  source: `extensions/opencode/${file}`,
  sha256: sha(`extensions/opencode/${file}`),
  targets: { opencode: { root: 'opencode', path: `plugins/${file}` } },
  order: 10 + index,
}));

const shared = [
  {
    id: 'consolidation-command',
    category: 'consolidation',
    version: VERSION,
    source: 'extensions/opencode/commands/end-session.md',
    sha256: sha('extensions/opencode/commands/end-session.md'),
    targets: { opencode: { root: 'opencode', path: 'command/end-session.md' }, 'claude-code': { root: 'claude', path: 'commands/end-session.md' } },
    order: 30,
  },
  {
    id: 'draft-collector',
    category: 'script',
    version: VERSION,
    source: 'extensions/opencode/scripts/collect-subagent-drafts.sh',
    sha256: sha('extensions/opencode/scripts/collect-subagent-drafts.sh'),
    targets: { opencode: { root: 'opencode', path: 'scripts/collect-subagent-drafts.sh' }, 'claude-code': { root: 'claude', path: 'scripts/collect-subagent-drafts.sh' } },
    order: 31,
  },
  {
    id: 'proxy-shim',
    category: 'shim',
    version: VERSION,
    source: 'dist/proxy/shim.js',
    sha256: sha('dist/proxy/shim.js'),
    targets: {
      opencode: { root: 'share', path: 'proxy/shim.js' },
      'claude-code': { root: 'share', path: 'proxy/shim.js' },
    },
    order: 40,
  },
];

const bundle = {
  schema: 1,
  name: 'mcp-task-knowledge',
  version: VERSION,
  generatedBy: 'scripts/gen-bundle.mjs',
  server: {
    package: 'mcp-task-knowledge',
    version: VERSION,
    command: ['npx', '-y', `mcp-task-knowledge@${VERSION}`],
    sha256: sha('package.json'),
  },
  components: [
    ...plugins,
    ...shared,
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(({ order, ...entry }) => entry),
};

const output = `${JSON.stringify(bundle, null, 2)}\n`;
const file = path.join(ROOT, 'bundle.json');
if (process.argv.includes('--check')) {
  const current = readFileSync(file, 'utf8');
  if (current !== output) {
    console.error('bundle.json is stale — run `npm run bundle`');
    process.exit(1);
  }
  console.log('bundle.json is up to date');
} else {
  writeFileSync(file, output, 'utf8');
  console.log(`bundle.json: ${bundle.components.length} components, version ${VERSION}`);
}
