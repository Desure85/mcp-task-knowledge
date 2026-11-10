# 2026-11-10 08:10 — Y-gate: единый контрактный набор на трёх профилях

- **Пункт:** gate §5.2 этапа Y (`docs/dev-cycle/plans/2026-11-09-y-stage.md`)
- **Ветка / sha:** `feat/y-gate-shared-contract`, от `origin/master` `86bf8cf` (PR #350 влит)
- **Основание:** план этапа Y §5 («один и тот же контрактный набор зелёный на трёх профилях»),
  решения Y-05a2/Y-06a1/Y-08a, новый CI-сервис Postgres (#350)

## Вопрос

Как доказать, что file, sqlite и postgres реализуют один и тот же контракт ADR-009, если текущие
наборы (`storage-contract.test.ts`, `storage-sqlite.test.ts`, `storage-postgres.test.ts`) писались
под каждый профиль отдельно и уже начали расходиться в семантике?

## Решение

1. Новый `tests/storage-contract-shared.test.ts`: **один runner**, который прогоняется тремя
   инстансами (file, sqlite, postgres) и проверяет одинаковые сценарии:
   - честный манифест с обязательными коллекциями;
   - жизненный цикл задач (create/get/update/close/archive/restore/list) и пагинацию с keys/total;
   - документы, версии и `HistoryProvider` (list/restore), архивацию/восстановление;
   - метаданные проекта (create/list/detail/updateMetadata/readMetadata);
   - сериализацию критических секций через `LockProvider` (три параллельных секции → `maxInside=1`);
   - журнал событий через per-path фабрику (`append/since/snapshot/snapshots` с `compact`).
2. Postgres-инстанс включается `POSTGRES_URL` (в CI — реальный сервис, локально — embedded
   PostgreSQL). Без переменной он документированно skip, file/sqlite всё равно исполняют тот же runner.
3. **Найденное расхождение исправлено в коде, а не подгонкой теста:** `sqlite` и `postgres` закрывали
   задачу жёстко в `status: 'done'`, файловый профиль — в `closeStatus` из workflow проекта (по
   умолчанию `closed`). Оба DB-профиля переведены на `workflowFor(...).closeStatus`; существующий
   postgres-тест, закреплявший старое поведение, обновлён на `closed`.
4. CI-шаг Postgres-контрактов расширен этим файлом: `storage-postgres` + `storage-migrate` +
   `storage-contract-shared` под `--maxWorkers=1` (общая БД).

## Почему

- Один runner исключает «каждый профиль зелёный по-своему»; расхождение проявилось сразу и в
  конкретном месте (close status), то есть набор работает как контрактный детектор.
- Postgres в том же runner, а не отдельным «похожим» набором — иначе §5.2 выполнялся бы формально.
- Cleanup через уникальные `shared-*` проекты не требует обнуления таблиц и не конфликтует с
  параллельными наборами.

## Проверено

- `tests/storage-contract-shared.test.ts` — **18/18**: 6 сценариев × 3 профиля против реального
  PostgreSQL 18.6 (embedded) + file/sqlite; `tsc` test-проекта чистый, build зелёный.
- Затронутые наборы: `storage-contract-shared`, `storage-postgres`, `storage-sqlite`,
  `storage-contract`, `storage-wiring`, `storage-migrate` — **108/108**.
- Revert-check: **3 мутации RED** — sqlite close игнорирует workflow; postgres close игнорирует
  workflow; sqlite lock «всегда захвачен» (критическая секция не сериализуется).
- CI: тот же набор включён в шаг `Storage contracts against real Postgres` (PR #351).

## Ограничения, записанные честно

- Набор покрывает контракт Store/History/Events/Locks; поиск и векторы проверяются отдельными
  профильными наборами (у них разная природа: `candidates` sync/async, ANN-гейты).
- Postgres-инстанс требует сервиса/встроенного PostgreSQL; без `POSTGRES_URL` он skip, а не «зелёный».

## Откат

Revert ветки: удаляется `tests/storage-contract-shared.test.ts`, возвращается жёсткий `status:'done'`
в sqlite/postgres close и ожидание в `storage-postgres.test.ts`; CI-шаг теряет один файл. Wire-формат
и остальные профильные наборы не затрагиваются.
