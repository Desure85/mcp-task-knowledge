# Field-eval fixtures (KE-06, partial)

## Why not ALB

ALB was the original source: `common/messages` (8 languages) and Bitrix24 field defs
(99 fields/groups). Those files are not in any public Desure85 repo; `pipeline-studio` has only
`src/i18n/messages/en.json` + `ru.json`, `neiroGen` has only `lang/en` + `lang/ru`.

## Builder

`scripts/build-field-eval-fixtures.mjs` is source-agnostic and supports JSON catalogs:

```bash
node scripts/build-field-eval-fixtures.mjs \
  --repo /path/to/repo \
  --label-dir src/i18n/messages \
  --out scripts/fixtures/field-eval/<name> \
  --allow-partial \
  --source-url https://github.com/Desure85/<repo>
```

It writes `gold_fields.json`, `multilingual_labels.json` and `manifest.json` (source, git commit,
languages, missing languages, counts, sha256). Without `--allow-partial` it fails when any of the
8 expected languages is missing, so a partial set cannot be mistaken for the full gate.

## Current fixture

`scripts/fixtures/field-eval/pipeline-studio/` was built from
`Desure85/pipeline-studio@fb71ecb` (`src/i18n/messages`):

- **213 fields**, groups from the first key segment;
- **2 languages**: en, ru;
- partial: missing de, es, fr, pl, pt, tr;
- numbers are **not comparable** to the old 2024-label report.

## What KE-06 still needs

1. A source with the 6 missing languages (or the original ALB `common/messages`).
2. Local Gemma/Granite ONNX models to rebase the report; `~/.local/share/mcp-task-knowledge/models`
   is absent in this environment.
3. A fresh `field-eval` run and an honest before/after report.

KE-06 remains **blocked**; this fixture is durable progress, not a closed gate.
