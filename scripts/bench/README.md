# scripts/bench — бенчмарки масштабируемости

Набор скриптов для замеров «что будет при 100k и 1M задач/документов». Не входит в `npm test`
и в CI: запускается вручную, пишет во временные каталоги, ничего не коммитит.

Полные результаты и выводы: [`docs/benchmarks/scale-2026-10.md`](../../docs/benchmarks/scale-2026-10.md).

## Быстрый старт

```bash
npm run build                      # бенчмарки гоняют реальный dist/index.js

# 1. Данные: 100k задач + 100k документов + 100k фактов графа
node scripts/bench/seed-scale.mjs --n 100000 --facts 100000 --out /tmp/mcp-scale/data-100k

# 2. Замеры через настоящий HTTP MCP (3 повтора, медиана/p95, размер ответа)
node scripts/bench/run-scale.mjs --data /tmp/mcp-scale/data-100k --n 100000 \
  --port 3420 --reps 3 --out /tmp/mcp-scale/res-100k.json

# 3. UI (нужны запущенные next dev и MCP-сервер)
node scripts/bench/ui-bench.mjs --base http://localhost:3440 \
  --playwright /path/to/playwright-core --pages tasks,knowledge --label n=100000

# 4. Граф: рендер SVG в браузере
node scripts/bench/graph-bench.mjs --sizes 76,200,1000,5000 \
  --playwright /path/to/playwright-core --out-dir /tmp/mcp-graph-bench
```

`npm run bench:scale` — то же, что шаг 2 (нужны `--data` и `--n`).

## Что важно знать

- **`/tmp` может быть tmpfs.** Проверьте `df -h /tmp` и `df -i /tmp`: для 1M файлов нужен запас
  inodes ≥ 3×, иначе делайте замеры на ext4 (как в проде) и ограничьтесь заглушками.
- **`SECURITY_STACK=0` по умолчанию** в `run-scale.mjs`: иначе `AuditLogger` пишет синхронно на
  каждый вызов, а rate limiter (60 токенов, burst 100, 1 rps) режет длинные циклы. Аутентификация
  при этом остаётся включённой. `--security-stack 1` — чтобы измерить накладные расходы стека.
- **`EMBEDDINGS_MODE=none`**: все цифры поиска — BM25 без векторов.
- **Таймаут MCP SDK по умолчанию 60 с.** `run-scale.mjs` передаёт `{ timeout }` в `callTool`,
  иначе большие list-операции выглядят как транспортная ошибка.
- **UI:** запускайте Next на `localhost`, не на `127.0.0.1` — иначе dev-ресурсы блокируются как
  cross-origin и страница не гидрируется. `MCP_API_URL` должен указывать на MCP-сервер.
- **Убирайте за собой:** скрипты пишут только в указанные `--out`/`--out-dir`; каталоги данных
  создаются вручную и удаляются вручную (`rm -rf` по точному пути).

## Файлы

| Файл | Назначение |
|---|---|
| `seed-scale.mjs` | генератор данных в формате приложения (детерминированный, `--seed`) |
| `run-scale.mjs` | HTTP MCP: латентность (медиана/p95), размер ответа, RSS, холодный старт |
| `ui-bench.mjs` | браузер: JSON-байты, время до отрисовки, DOM-узлы, Long Tasks, heap |
| `graph-bench.mjs` | SVG-граф: HTML-размер, рендер, Long Tasks, скриншоты |
