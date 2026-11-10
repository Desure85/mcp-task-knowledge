# 2026-11-10 10:00 — Y-gate §5.6 и закрытие этапа Y

- **Пункт:** gate §5.6 (`doctor` показывает активный профиль/манифест/возможности) и gate §5.7
  (документация/CHANGELOG/AGENTS), закрытие этапа Y
- **Ветка / sha:** `feat/y-gate-doctor`, от `origin/master` `5e83af2` (PR #352 влит)
- **Основание:** `docs/dev-cycle/plans/2026-11-09-y-stage.md` §5, решения Y-05c (doctor для SQLite),
  Y-06a1/Y-06b/Y-08 (профили и миграция)

## Вопрос

Как показать в `doctor` реальный активный профиль, а не «предполагаемый», и можно ли после этого
честно объявить этап Y закрытым?

## Решение

1. Новый `src/cli/storage-profile-inspect.ts`: `inspectActiveStorageProfile(dataDir, env)` строит
   **реальный профиль** по `STORAGE_PROFILE` и возвращает `profile`, `roots`, `collections`,
   `capabilities`; отсутствующая SQLite-БД и недоступный Postgres/неизвестный профиль возвращаются
   как `error`, а не создаются/замалчиваются. Postgres инспектируется с `manageExtensions:false`.
2. `doctor` получил секцию `storage` в отчёте и строки в текстовом выводе:
   `Storage profile`, `Storage collections`, `Storage capabilities`, `Storage roots`; ошибка
   профиля добавляется предупреждением `storage-profile` (exit-код не меняется).
3. Документация gate §5.7: в `configuration.md` добавлен `postgres`/`POSTGRES_URL`, в
   `architecture.md` — раздел о подключаемом хранилище (file/sqlite/postgres, общий контракт,
   миграция, честность возможностей). CHANGELOG/AGENTS/BACKLOG обновлены.
4. **Этап Y закрыт** по всем пунктам §5 плана; evidence ниже. Незакрытые ограничения записаны как
   follow-up'ы (производительность Postgres/file-поиска, COPY/батчи миграции, MU-02, pgvector/HNSW
   локально не проверен).

## Почему

- Врать в `doctor` нельзя: «активный профиль» должен совпадать с тем, что реально откроет сервер,
  поэтому инспектор строит профиль и отдаёт его манифест, а не константу.
- Отсутствие БД/URL — это диагностический факт, а не повод молча создать пустую БД (иначе doctor
  менял бы состояние).
- Закрытие этапа фиксируется только после проверки всех семи условий, а не после «все подпункты done».

## Проверено (все условия §5)

| Условие | Evidence |
|---|---|
| §5.1 все Y-02…Y-08 done | BACKLOG: 300 done / 98 pending, Y row 9/0, subitems закрыты |
| §5.2 один контрактный набор на трёх профилях | `tests/storage-contract-shared.test.ts` 18/18 (file/sqlite/postgres), PR #351 |
| §5.3 embedding/blob/migrate + сервисные CI-прогоны | CI `bulk-smoke`: реальные `postgres:16` (18/18) и MinIO (blob 25/25), PR #350; migrate 5/5 |
| §5.4 миграция в обе стороны | `tests/storage-migrate.test.ts` 5/5, dry-run/идемпотентность/verify-only; 100k pause 42.9 с |
| §5.5 benchmarks hit@1/medianMs/RSS на 100k | `docs/benchmarks/` — hit@1=1.0; medianMs file 213.4 / sqlite 0.25 / postgres 727.8; RSS 355/265/99 MB, PR #352 |
| §5.6 doctor | новый `storage-profile-inspect` + секции doctor; 4/4 теста, 3 мутации RED |
| §5.7 документация | `configuration.md` (postgres/POSTGRES_URL), `architecture.md` (профили), CHANGELOG, AGENTS, BACKLOG; `backlog:check`/markdownlint |

- `doctor`-инспектор: 4/4 (`file` манифест, sqlite только при существующей БД, postgres без URL —
  ошибка, неизвестный профиль — ошибка); **3 мутации RED** (профиль всегда file, capabilities
  выброшены, отсутствующая sqlite создаётся молча).
- `tsc` test-проекта чистый, build зелёный; eslint без ошибок.

## Ограничения, записанные честно

- Postgres/file-латентность из §5.5 (727.8/213.4 мс) — **follow-up-оптимизации**, не блокеры
  закрытия: числа опубликованы как есть.
- MU-02 (оптимистичные версии), pgvector/HNSW (нет расширения локально), COPY/батчи миграции и
  межпроцессный lock сервера остаются отдельными пунктами бэклога/долга.
- Этап закрыт по критериям плана; это не означает, что перечисленные улучшения сделаны.

## Откат

Revert ветки: удаляются `src/cli/storage-profile-inspect.ts`, секция `storage` в `doctor` и тест;
откатываются правки `configuration.md`/`architecture.md` и запись о закрытии этапа в
BACKLOG/CHANGELOG/AGENTS. Профили, wire-формат и данные не затрагиваются.
