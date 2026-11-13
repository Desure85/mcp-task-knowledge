# Field-eval fixtures (KE-06)

## Universal, not 8-language

The old gate hardcoded 8 languages. That is now a fixture property, not a platform rule:

- `scripts/build-field-eval-fixtures.mjs` accepts **any JSON catalog set with ≥2 languages**;
- `scripts/field-eval.mjs` reads the language list from the labels file (or `--langs a,b`);
- `--require-langs de,es` is an opt-in gate for teams that want a specific set;
- no `EXPECTED_LANGS` constant remains.

## Current fixture

`scripts/fixtures/field-eval/pipeline-studio/` — from
`Desure85/pipeline-studio@fb71ecb` (`src/i18n/messages`):

- **213 fields**, groups from the first key segment;
- **2 languages**: en, ru;
- `manifest.json`: `requiredLanguages: []`, `missingLanguages: []`, `partial: false`;
- sha256 of gold/labels recorded.

Regenerate:

```bash
node scripts/build-field-eval-fixtures.mjs \
  --repo /path/to/repo --label-dir src/i18n/messages \
  --out scripts/fixtures/field-eval/<name> \
  --source-url https://github.com/Desure85/<repo>
```

## Granite report

`docs/benchmarks/kb-hardening-field-eval-pipeline-studio.json`:

| Model | Gold top-1 | Gold top-3 | en top-1 | ru top-1 |
|---|---|---|---|---|
| Granite 311M multilingual R2 q8 | 179/213 (84.0%) | 202/213 (94.8%) | 77/213 (36.2%) | 64/213 (30.0%) |

Command:

```bash
node scripts/field-eval.mjs --models granite \
  --gold scripts/fixtures/field-eval/pipeline-studio/gold_fields.json \
  --labels scripts/fixtures/field-eval/pipeline-studio/multilingual_labels.json \
  --json-out docs/benchmarks/kb-hardening-field-eval-pipeline-studio.json
```

## Limits

- The numbers are **not comparable** to the lost 2024-label report: different domain (UI strings),
  213 entries, 2 languages.
- **Gemma was not run**: the public `gemma-2-2b-it-ONNX` repo is gated (HTTP 401); only Granite
  q8 was downloaded and measured.
- The builder supports JSON catalogs only; PHP `common/messages` and Bitrix24 defs are not parsed.
- Cross-language top-1 is low (30–36%) because the fixture contains UI strings, not partner fields;
  this is a property of the fixture, recorded rather than hidden.
- Models are local-only (`~/.local/share/mcp-task-knowledge/models`); CI does not run the eval.
