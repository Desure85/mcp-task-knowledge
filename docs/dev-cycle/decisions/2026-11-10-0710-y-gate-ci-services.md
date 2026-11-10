# 2026-11-10 07:10 — Y-gate: CI-сервисы Postgres и MinIO для контрактных прогонов

- **Пункт:** gate §5.3 этапа Y (`docs/dev-cycle/plans/2026-11-09-y-stage.md`)
- **Ветка / sha:** `feat/y-gate-ci-services`, от `origin/master` `46c53e4` (PR #349 влит)
- **Основание:** план этапа Y §5 (условие закрытия), решения Y-06a1/Y-07b (локальные прогоны без
  сервисов в CI), новые scopes токена (`repo`, `workflow`)

## Вопрос

Как прогнать контрактные наборы Postgres-профиля и MinIO-blob-провайдера на настоящих сервисах в CI,
не превращая основной job в долгий и не ломая parallel-тесты, и как обойти то, что GitHub Actions
`services:` не умеет передавать команду `server /data` образу `minio/minio`?

## Решение

1. В `bulk-smoke.yml` добавлен **service `postgres:16`** с healthcheck (`pg_isready`) и БД `mcp_test`.
2. **MinIO поднимается шагом `docker run -d minio/minio server /data`** с ожиданием
   `/minio/health/live` и гарантированным `docker rm -f` в `if: always()`: services-секция не
   поддерживает command, поэтому запуск отдельным шагом — единственный честный способ.
3. Контрактные прогоны вынесены **в отдельные шаги после unit-тестов**:
   - `storage contracts against real Postgres`: `tests/storage-postgres.test.ts` +
     `tests/storage-migrate.test.ts`, `POSTGRES_URL=...`, `--maxWorkers=1` (общая БД, поэтому
     последовательно, без гонки между файлами);
   - `blob contract against real MinIO`: `tests/blob-provider.test.ts` с `BLOB_S3_*` на локальный
     MinIO, `--maxWorkers=1`.
   Основной `npm test` остаётся без `POSTGRES_URL`/`BLOB_S3_*`: сервисные тесты в нём документированно
   skip'аются, а реальные прогоны идут отдельными шагами и дают видимый статус.
4. Пуш воркфлоу стал возможен после появления scope `workflow` у токена `gh`. Это ограничение,
   которое раньше блокировало gate, снято владельцем.

## Почему

- Один и тот же job уже собирает проект и запускает тесты; добавлять сервисы туда дешевле, чем
  отдельный workflow с повторной установкой зависимостей.
- Изоляция сервисных прогонов отдельными шагами с `maxWorkers=1` убирает гонку за одну БД и делает
  падение сервисного контракта однозначно читаемым в UI.
- MinIO отдельным шагом — осознанный компромисс: альтернатива (образ, который сам стартует сервер)
  менее канонична и хуже документируется; текущий подход воспроизводит ручной runbook из
  `docs/features/blob-storage.md`.

## Проверено

- `bulk-smoke.yml` распарсен YAML-парсером: job `bulk-smoke`, service `postgres`, 20 шагов, включая
  Postgres-контракт и MinIO start/blob/stop.
- Локально те же наборы уже зелёные против настоящих PostgreSQL 18.6 и fake-MinIO; в CI прогон на
  `postgres:16`/`minio/minio` — решающая проверка этого инкремента (по логам PR).
- `npm run test:types`, `npm test` не менялись; новых зависимостей нет.

## Откат

Revert ветки: удаляются `services: postgres` и шаги MinIO/контрактов из `bulk-smoke.yml`; остальные
job'ы и тесты не затрагиваются. Wire-формат и код приложения не менялись.
