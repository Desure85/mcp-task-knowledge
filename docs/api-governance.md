# API governance (TR-10)

Status: **policy**, applies to every MCP tool and resource. Design-only change: no runtime
enforcement exists yet; this document is the review contract for future PRs.

## Versioning

- The server package follows semver (`package.json`); the MCP wire protocol is versioned
  separately (`protocolVersion`, SPEC-09).
- A **minor** release may add tools, optional input fields, response fields, enum values and
  new error codes. Existing names, shapes and semantics do not change.
- A **major** release may remove or rename a tool/field, make an optional input required,
  change an error envelope shape, or change the meaning of an existing field.
- There is no separate per-tool version. `tools/list` is the source of truth; clients must
  tolerate unknown tools and unknown response fields.

## Compatibility rules

1. Additive first: new behavior goes behind a new tool or a new optional field.
2. Never reuse a removed name for a different meaning; reserve it for at least one major cycle.
3. Enums grow, they do not shrink. Clients must ignore unknown values rather than fail.
4. `{ ok: true, data }` and `{ ok: false, error: { message } }` are stable. `meta`, `code`,
   `hint`, `details` are additive siblings.
5. Pagination/shape changes (`total`, `count`, cursor) are breaking unless the old fields
   remain truthful.
6. Wire-format snapshots and contract tests are updated in the same PR as the change.

## Error taxonomy

| Class | Meaning | Examples |
|---|---|---|
| `VALIDATION_ERROR` | input does not satisfy the published schema | `QUERY_SYNTAX`, `EVIDENCE_INVALID` |
| `NOT_FOUND` | addressed entity does not exist | `TASK_NOT_FOUND`, `DOC_NOT_FOUND` |
| `CONFLICT` | state changed or preconditions not met (CAS) | `CONFLICT`, `TASK_CLAIMED`, `DEPENDENCY_CYCLE` |
| `FORBIDDEN` | caller lacks permission/role | `ACL_DENIED`, `AUTH_LOCKED` |
| `UNAVAILABLE` | capability/profile/backend is off or down | `CAPABILITY_UNAVAILABLE`, `STORAGE_UNAVAILABLE` |
| `RATE_LIMITED` | quota exhausted; retry may succeed | `RATE_LIMITED` |
| `CONFIRM_REQUIRED` | destructive action needs explicit confirmation | `CONFIRM_REQUIRED` |
| `INTERNAL` | unexpected server failure; no retry guarantee | `INTERNAL_ERROR` |

Rules:

- `message` is human-readable; `code` is stable, uppercase `SNAKE_CASE`, and never localized.
- A new code is documented in the tool's description or `docs/api-reference.md` in the same PR.
- One code means one condition; do not overload `BAD_REQUEST` for new distinct failures.
- `hint` says what to do next; `details` carries structured context, never secrets.
- Tools that validate input return the validation code, not a generic `INTERNAL`.

## Naming

- Pattern: `<domain>_<verb>` — `tasks_create`, `knowledge_search`, `project_board_get`.
- Domains are stable nouns (`tasks`, `knowledge`, `memory`, `prompts`, `project`, `admin`).
- `_bulk_` marks multi-item operations; `_list` returns a page; `_get` returns one entity.
- Existing exceptions (`tools_run`, `tools_batch`, `briefing`, `changes_since`,
  `graph_neighbors`) are frozen; new tools follow the pattern.
- A tool does one thing. A combined read/write needs a separate design review.
- Admin/ops tools keep the `admin_` prefix; agent-facing aliases do not hide a write.

## Deprecation

1. Mark the tool/field in `docs/api-reference.md` and the MCP description with
   `[DEPRECATED since X.Y: use <replacement>]`.
2. Keep it working for at least **two minor releases** (or 90 days, whichever is longer).
3. Return the old response plus a `hint` pointing to the replacement; do not fail callers
   merely because they use a deprecated name.
4. Remove only in a major release, with a CHANGELOG entry and an ADR if the replacement
   changes a workflow.

Current gap: the tool registry has no runtime `deprecated` flag, so step 1 is documentation
only. Adding the flag is a separate change (not part of TR-10).

## PR checklist for API changes

- [ ] Change is additive, or a major release is explicitly planned.
- [ ] `docs/api-reference.md` regenerated/updated; tool count in README if changed.
- [ ] Contract test or snapshot covers the new field/error.
- [ ] `CHANGELOG.md` entry names the user-visible change.
- [ ] Backward-compatibility note in the PR: what old clients see.
- [ ] Breaking change: ADR + owner approval before merge.

## Known exceptions / limits

- `~200` tools share one dispatch table; there is no per-tool semver and no runtime
  deprecation metadata.
- Tool profiles (AA-08) hide tools by allowlist; a hidden tool returns `TOOL_NOT_FOUND`, which
  is a profile boundary, not a deprecation.
- This policy does not cover prompt/skill file formats or storage schemas; they have their
  own ADRs.
