# Prompt package provenance (Z-06)

Tracks where an imported prompt/skill package came from, detects local edits, and supports
snapshot-based diff updates and rollback. This is the storage layer between Z-05 sources and a
future Z-07 merge flow; it is not exposed as an MCP tool yet.

## Layout

```text
<root>/<package-id>/
  manifest.json                 provenance + contentHash + snapshotId + history
  files/                        the current package (relative paths)
  snapshots/<snapshot-id>/files the imported and pre-update states
```

`manifest.json` records `source` (`kind`, `id`, optional `url`, `version`, `commit`, `license`,
`retrievedAt`), import time, SHA-256 over sorted `path\0length\0content`, the current snapshot id,
and history entries for every previous state.

## Usage

```ts
import { PromptProvenanceStore } from './src/prompts/provenance.js';

const store = new PromptProvenanceStore(root);
await store.import('skill-a', files, {
  kind: 'github', id: 'owner/repo@abc123', url: '…', version: '1.0.0', license: 'MIT',
});

const status = await store.status('skill-a');       // modified: false
const diff = await store.diff('skill-a', nextFiles); // added / changed / removed
const result = await store.update('skill-a', nextFiles, { ...source, version: '2.0.0' });
await store.rollback('skill-a', result.manifest.history[0].snapshotId);
```

- `import` refuses an existing id unless `{ overwrite: true }`; overwrite archives the old state
  and keeps history.
- `update` computes the diff first; with no changes it returns `{ updated: false, diff: [] }`.
  If the current files hash differs from the manifest (local edits), it throws
  `ProvenanceError('MODIFIED')` and writes nothing unless `{ force: true }`.
- `rollback` archives the current state before restoring the chosen snapshot.
- Paths are validated (`..`, absolute/drive paths, empty segments, duplicates, symlinks), package
  ids are restricted to a safe character set, and files are UTF-8 strings.

## Boundaries

- No MCP tool/web UI; Z-07 is the merge/apply consumer.
- No 3-way merge or semantic conflict detection — `diff` is path-level only.
- `force` overwrites local edits intentionally; ordinary `update` never does.
- Snapshots are full copies, not deltas; large packages multiply disk use.
- Package files are strings; binary files are not supported.
- `rollback` does not check local modifications before restoring.
- Writes are not transactional; a crash can leave a partially written `files/` tree.
