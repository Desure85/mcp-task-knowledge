# 2026-11-12 11:25 — MU-02: optimistic version CAS (implementation)

- **Пункт:** MU-02 (high; design-контракт — `2026-11-12-1110-mu-02-contract.md`)
- **Ветка / sha:** `feat/mu-02-task-cas`, от `origin/master` `2bce938`

## Вопрос

Реализовать контракт версии на write-путях: `version`, `fieldVersions`, необязательный
`expectedVersion`, field-level merge и `CONFLICT` с текущими значениями/диффом.

## Решение

- `Task.version`/`Task.fieldVersions` (create = 1/`{}`); `KnowledgeDocMeta.fieldVersions` (create = 1/`{}`).
- Общий helper `src/storage/optimistic.ts`: при `expectedVersion < current` конфликтуют только поля
  с `fieldVersions[field] > expectedVersion`; иначе поля сливаются и версия +1.
- `TaskStore.update(project, id, patch, expectedVersion?)` во всех трёх профилях:
  file → `updateTask`; sqlite → helper + write; postgres → `patchTask` + helper.
- `tasks_update` принимает `expectedVersion` и отдаёт `version`/`fieldVersions` аддитивно.
- `updateDoc(..., expectedVersion?)` реализует тот же CAS в file-профиле; публичного
  `knowledge_update` tool нет, поэтому CAS доступен storage/upsert-слою.
- `CONFLICT` — `WorkflowError` с `details { expectedVersion, currentVersion, fields, current, diff }`.

## Почему

- Один helper исключает расхождение трёх профилей.
- `expectedVersion` опционален → LWW для старых клиентов, wire не ломается (только аддитивные поля).
- Field-level merge соответствует требованию «разные поля сливаются, конфликт только по одному полю».

## Проверено

- `tests/task-optimistic-lock.test.ts` — **3/3**: task version/merge/conflict/future version; doc
  merge/conflict. **Мутация RED:** проверка `expectedVersion` отключена → 2 теста падают.
- `tests/storage-contract.test.ts` + docs coverage — **40/40**; `npm run build` чисто; API reference
  перегенерирован (161 tool).
- backlog:check **381 done / 0 pending / 39 blocked / 1 deferred**.

## Ограничения

- Prompts: отдельного update-tool с `expectedVersion` нет; semver-версия файлов не получает CAS.
- Docs CAS доступен только storage/upsert, не MCP-инструменту (его нет).
- `version`/`fieldVersions` добавлены в JSON-документы; старые записи без них считаются версией 1.
- SQLite/Postgres CAS проверен сборкой/контрактом, но не отдельным конфликтным e2e.

## Откат

Вернуть `TaskStore.update` к трём аргументам, удалить helper/поля/`expectedVersion` из tool и
`updateDoc`, тест; данные с полями останутся аддитивными.
