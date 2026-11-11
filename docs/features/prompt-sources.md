# Prompt sources (Z-05)

Read-only catalogs of prompts/skills that can be searched, previewed and imported into a local
directory. The layer is intentionally independent of the prompt registry: importing copies the
source document, it does not create a typed prompt version.

## Interface

```ts
import { LocalMarketplaceSource, GitHubPromptSource } from './src/prompts/sources.js';

const source = new LocalMarketplaceSource('/path/to/marketplace');
const items = await source.list('review');       // query is a case-insensitive substring
const preview = await source.preview('hello');   // { ...item, content, bytes }
const imported = await source.import('hello', '/tmp/prompts', { overwrite: false });
```

Both implementations return `PromptSourceItem` (`id`, `title`, `description?`, `version?`,
`tags?`, `kind?`, `path?`) and `PromptSourcePreview` (`content`, `bytes`).

## Local marketplace

- Manifest: `.claude-plugin/marketplace.json` or `marketplace.json` with a `plugins` array.
- Each plugin: `name`, optional `description`/`version`, and `source` (relative path to a file or
  directory). Directories are searched for `SKILL.md`, `PROMPT.md`, `prompt.md`, `README.md`,
  `<name>.md`, `<name>.json`, in that order.
- Without a usable manifest the root is scanned (5 levels, skip dotfiles) for `.md`/`.json`.
- Paths are checked twice: lexical (`..`/absolute) and `realpath` (symlinks), so a plugin cannot
  point outside the marketplace. Escapes raise `PATH_ESCAPE`.

## GitHub

```ts
const gh = new GitHubPromptSource({
  repo: 'owner/repo', ref: 'main', token: process.env.GITHUB_TOKEN,
  fetchImpl: fetch, // injectable for tests
});
```

- Listing uses `GET /repos/{repo}/git/trees/{ref}?recursive=1` and keeps blobs under
  `prompts/`, `skills/`, `rules/`, `workflows/`, `templates/`, `policies/` (or any `SKILL.md`).
- Preview/import uses `https://raw.githubusercontent.com/{repo}/{ref}/{path}`.
- `id` is the repository path, so `preview('prompts/greet.md')` is unambiguous.
- Tests inject `fetchImpl`, `apiBase` and `rawBase`; no network is required.

## Errors

`PromptSourceError` codes: `NOT_FOUND`, `INVALID_SOURCE`, `PATH_ESCAPE`, `TOO_LARGE`
(2 MiB per document). Import is `wx` by default; `overwrite: true` replaces an existing file.

## Limits

- No MCP tool or web UI yet: this is the source layer only.
- Marketplace `source` must be a path; URL/git-based plugin sources are not resolved.
- GitHub listing is unauthenticated/rate-limited without `token`; no pagination beyond the
  recursive tree API limit, no archive/ZIP fallback, title comes from the filename.
- Import copies raw documents; parsing into the prompt registry/skill package is the caller's job.
- Only the first tag/dir convention is used; arbitrary marketplace metadata is not mapped.
