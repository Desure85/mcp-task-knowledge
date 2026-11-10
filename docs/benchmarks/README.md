# Профильные benchmark'и

## 100k задач: hit@1 / medianMs / RSS

Источник чисел — `scripts/profile-bench.mjs`, полный вывод — [`profiles-100k.md`](profiles-100k.md)
и [`profiles-100k.json`](profiles-100k.json).

```bash
npm run build
node scripts/profile-bench.mjs --count 100000 --queries 50
# Postgres-строка включается при POSTGRES_URL (CI-сервис или локальный PostgreSQL)
POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/mcp_test \
  node scripts/profile-bench.mjs --count 100000 --queries 50
```

## Методика

- Корпус: 100k задач, в title каждой — уникальный токен `marker-<i>`; 50 запросов равномерно по
  корпусу. `hit@1` — доля запросов, где top-1 кандидат совпал с задачей-владельцем токена.
- Каждый профиль исполняется в **отдельном процессе** (чистый RSS): file — прямые JSON-файлы,
  sqlite — INSERT в транзакции, postgres — батчи по 500. Далее штатный
  `SearchProvider.ensureIndexed(project)` и ожидание `isIndexComplete`.
- Для file-профиля child поднимает те же process-wide индексы, что сервер:
  `createMetadataIndex` + `FtsSearchIndex.open` + `setActiveMetadataIndex/setActiveFtsIndex`.
- `medianMs`/`p95Ms` — только латентность запросов кандидатов; seed/index измеряются отдельно.
- RSS — после построения индекса, дельта — от старта процесса.
- Эмбеддинги отключены (`EMBEDDINGS_MODE=none`): это сравнение **полнотекстового** поиска.

## Что числа не означают

- Это не оценка качества ранжирования: токены уникальны, `hit@1=1.0` проверяет, что индекс
  находит внедрённый маркер.
- Абсолютные миллисекунды зависят от машины (Windows, embedded PostgreSQL 18.6); сравнивайте
  соотношения и повторные прогоны.
- Postgres показывает ~728 мс/запрос против 0.25 мс у sqlite; это записанный follow-up на
  оптимизацию, а не «всё хорошо».
