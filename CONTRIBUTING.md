# Contributing to mcp-task-knowledge

Спасибо за интерес к проекту! Ниже — как устроен процесс разработки.

## Стек

TypeScript (strict), Node.js 22+ (CI: 22.x and 24.x), ESM, Vitest, Zod. Данные — Markdown/JSON файлы.

## Начало работы

```bash
npm install
npm run build
npm test
```

Тесты: `npm test` (vitest), type-check тестов: `npm run test:types`,
покрытие: `npm run test:coverage` (порог 80% на src/).

## Процесс

1. **Feature-ветка от master**: `git checkout -b feat/<description>`
2. **WIP-коммит** перед началом работы: `git wip "BACKLOG-XXX — начал"` (TD-014)
3. **Session ID** в каждом коммите: `[S-<id>]` (например `S-20260829-a1b2`)
4. **Трёхфазный цикл**: research → plan → implement (каждый этап — коммит)
5. **Проверки перед PR**:
   - `npm run test:types` — type-check всех тестов
   - `npm test` — полный набор
   - `npm run test:coverage` — порог 80%
   - `npm run lint` — ESLint (0 errors)
6. **PR в master** — описание: что, почему, что не сделано, ссылка на BACKLOG

## Стандарты кода

- JSDoc только для «why», не «what»
- Типы через `interface`/`type`, без `any` без крайней необходимости
- Валидация входов — zod
- Ответы инструментов — `ok()`/`err()` из `src/utils/respond.ts`
- Новый код должен давать 0 ESLint warnings

## Документация — executable docs (DX-24)

`npm run docs:test` прогоняет `scripts/executable-docs.mjs` по `README.md` и
`docs/**/*.md` и валидирует fenced code blocks:

- ```` ```json ```` / ```` ```jsonc ```` — парсится через `JSON.parse`
- ```` ```typescript ```` / ```` ```ts ```` — syntax-check через `ts.transpileModule` (не выполняется)
- ```` ```javascript ```` / ```` ```js ```` — syntax-check через `new Function` (не выполняется)
- ```` ```bash ```` / ```` ```sh ```` / ```` ```console ```` — **по умолчанию пропускается**;
  выполняется только с маркером `<!-- doc-test: run -->` на строке над блоком
  (в изолированном temp cwd с temp `DATA_DIR`, `HOME`, `EMBEDDINGS_MODE=none`)

Маркеры (HTML-комментарий на строке прямо над открывающим fence):

```markdown
<!-- doc-test: skip -->   — пропустить блок (псевдокод, неполный пример)
<!-- doc-test: run -->    — выполнить bash-блок (только для безопасных команд)
```

Правила:

- Псевдокод с `...`, несуществующими идентификаторами, плейсхолдерами — `doc-test: skip`.
- `docker run`, `npm install -g`, `claude mcp add`, `curl`, `cp` в домашнюю папку —
  без маркера (skip по умолчанию для bash).
- `doc-test: run` — только для команд, которые безопасно выполнить в CI:
  `export`, `echo`, `node --version`, локальные скрипты без сети/побочных эффектов.

## Структура

```
src/
  core/       # AppContainer, ToolExecutor, middleware, session, auth
  register/   # регистрация MCP-инструментов
  storage/    # tasks/knowledge (файловые)
  search/     # BM25 + vector (ONNX)
  rules/      # guard rules
  workflows/  # AI workflow execution
  skills/     # agent skills
  behavioral/ # memory: intents/failures/resolutions
  relay/      # LAN Relay (BM-012)
  proxy/      # thin proxy
docs/
  architecture.md  # Mermaid-диаграммы
  adr/             # Architecture Decision Records
  api-reference.md # автогенерируемый справочник (npm run api:reference)
```

## Supply chain (TR-06)

Базовый комплект защиты цепочки поставок:

- **Dependabot** (`.github/dependabot.yml`) — еженедельные PR на npm-зависимости
  и GitHub Actions. Minor+patch сгруппированы, majors — отдельными PR.
  Security-обновления приходят вне расписания.
- **npm audit gate** — в `bulk-smoke.yml` шаг `npm audit --omit=dev --audit-level=high`
  после `npm install`. Шаг **блокирующий**: одна находка high или critical в
  продакшн-дереве валит job, поэтому уязвимая рантайм-зависимость не попадает в
  `master`. Находки moderate и ниже печатаются в лог, но не блокируют. Реестр в
  шаге прибит к `registry.npmjs.org` намеренно: `.npmrc` указывает на зеркало,
  чей advisory-endpoint не гарантирован.
- **SHA-pinning actions** — в `publish.yml`, `docker-build.yml`,
  `docker-build-base.yml` все third-party actions запинены на commit SHA
  (`uses: owner/repo@<40-hex> # vX.Y.Z`). Остальные workflow — follow-up.
  При обновлении action: `gh api repos/<owner>/<repo>/git/ref/tags/vN` →
  подставить SHA и обновить комментарий.
- **Minimum release age** — новая зависимость должна быть опубликована ≥7 дней
  назад (окно для обнаружения supply-chain атак типа ua-parser-js/colors.js).
  Проверка ручная: `npm view <pkg> time.<version>` перед `npm install`.
  npm пока не имеет нативного `minimumReleaseAge` (есть в pnpm 10.16+ /
  yarn 4.x) — когда появится, включить в `.npmrc`.
- **`.npmrc` registry** — локальный mirror (npmmirror.com) намеренный для
  dev-скорости; CI и publish всегда идут через `registry.npmjs.org`
  (`NPM_CONFIG_REGISTRY` в workflow). Не менять.

### Что делать, если npm audit красный

Красный шаг `npm audit (production deps, blocks on high or critical)` останавливает merge, а не «предупреждает». Порядок:

1. Прочитать advisory в логе шага: имя пакета, severity, ссылка на GHSA. Проверить, что пакет действительно в продакшн-дереве: `npm ls <пакет>`.
2. Попробовать `npm audit fix` без `--force` — это обновления в пределах заявленных диапазонов, обычно патч или minor.
3. Если без `--force` не чинится, нужен мажор — это отдельное решение владельца (см. `docs/dev-cycle/production-grade.md`, класс `owner`), а не «побочный эффект зелёного CI». Мажор идёт своей задачей и своим PR.
4. Если апгрейд невозможен (пакет заброшен, транзитивная зависимость без релиза) — `overrides` в `package.json` с комментарием-причиной и номером задачи-владельца; сама запись фиксируется файлом в `docs/dev-cycle/decisions/` (что и почему остаётся уязвимым, как откатить).
5. `npm audit fix --force` в этом репозитории запрещён: он меняет мажорные версии молча.
6. В отчёте/PR указать: было/стало по `npm audit --omit=dev --json` (`.metadata.vulnerabilities`) и что именно закрывает находку.

## BACKLOG

Единственный источник правды по задачам: `BACKLOG.md`. Сводка «Итого»
внизу валидируется в CI (`npm run backlog:check`) — обновляйте её при
изменении статусов задач.
