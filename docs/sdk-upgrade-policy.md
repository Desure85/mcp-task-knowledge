# SDK upgrade policy (SPEC-10)

Applies to `@modelcontextprotocol/sdk` (currently `^1.32.0`, lockfile `1.32.2`).

## Cadence

- **Monthly** routine sweep: check the SDK changelog and open one upgrade PR if there is a
  newer version. Do not bundle unrelated feature work into that PR.
- **Immediately** for a security advisory or a protocol bug that blocks a supported client;
  still treat it as a normal review with the checklist below.
- No upgrade during a release freeze; the release branch keeps its lockfile.

## What counts as routine vs. reviewed

| Change | Path |
|---|---|
| patch/minor within `^1.32` with no new protocol methods | routine upgrade PR, CI gates |
| minor/major that adds/removes protocol methods or changes schemas | **ADR + design review** before merge |
| capability behavior change (what the server advertises) | review `docs/mcp-spec-frontier.md` in the same PR |
| transport/wire-format change | contract tests + e2e on stdio, HTTP, stream |

## Checklist (paste into the PR)

- [ ] Read the upstream changelog; list every new/removed/changed method and capability.
- [ ] For each new method: is it taken or rejected in `docs/mcp-spec-frontier.md`? No
      advertised capability without a handler.
- [ ] No `tools/list`/schema drift: `tests/tool-schema-contract` and wire snapshots green.
- [ ] `npm ls @modelcontextprotocol/sdk` → one version, no duplicate copies.
- [ ] `npm run build`, `npm run test:types`, `npm run lint`, `npm test`.
- [ ] `npm run e2e:full` (stdio + HTTP + stream) on the changed SDK.
- [ ] Node 20/24 compatibility matrix if the SDK bumps its `engines`.
- [ ] `npm run backlog:check`; CHANGELOG entry names the SDK version.
- [ ] Rollback = revert the lockfile + package.json in one commit.

## Current state / gaps

- There is **no automated SDK bump** (no Dependabot/Renovate config); the monthly sweep is a
  human/agent task.
- The SDK is a runtime dependency; a bad bump can break every transport. CI covers unit and
  e2e, but there is no nightly "latest SDK" canary.
- `package.json` uses a caret range; the lockfile is the actual pin. Do not widen the range
  without the review path above.
- Prompt/skill schemas and storage formats are out of scope (their own ADRs).

## Why this policy

The SDK is the wire contract. Treating every bump as a routine `npm update` hides protocol
changes; treating every patch as an ADR blocks security fixes. The split above keeps routine
patches cheap and makes method/capability changes explicit.
