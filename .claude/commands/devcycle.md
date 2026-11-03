---
description: Управление циклом разработки mcp-task-knowledge (status, start, resume, stop, tick, next, report)
argument-hint: status|start|resume|stop|tick|next|report
allowed-tools: Bash, Read
---

# /devcycle — управление циклом разработки

Аргумент: `$ARGUMENTS`. Если аргумент пуст, выполни `status`.

Команда работает с локальным состоянием цикла (каталог `DEVCYCLE_STATE_DIR`, по умолчанию
`.devcycle/`, в git не попадает) и с расписанием Claude Code (инструменты CronCreate,
CronList, CronDelete). Полные правила цикла: `docs/dev-cycle/README.md`,
`docs/dev-cycle/tick.md`, `docs/dev-cycle/rules.md`.

## status

1. Выполни `node scripts/devcycle.mjs status`.
2. Перескажи по-русски коротко: состояние цикла, что требует внимания (красный CI, PR с
   конфликтом, зависшая сессия, отставший worktree), и следующий пункт.
3. Ничего не меняй. `status` это проба: без fetch, без движения квоты LoopX.

## next

1. Выполни `node scripts/devcycle.mjs next`.
2. Покажи выбранный пункт, причину выбора и первые пропущенные пункты с причинами.

## start

1. Выполни `node scripts/devcycle.mjs state get --json`.
2. Выполни CronList. Если `enabled=true` и живое расписание с промптом `/devcycle tick`
   уже есть, скажи «цикл уже запущен» и остановись: второе расписание запрещено, два тика
   подряд дают два merge.
3. Создай расписание CronCreate каждые 15 минут (минуты 7, 22, 37, 52) с промптом
   `/devcycle tick`.
4. Запиши состояние и лог:
   `node scripts/devcycle.mjs state enable --cron-id <id из CronCreate>`
   и `node scripts/devcycle.mjs log "цикл запущен, cron <id>"`.
5. Предупреди: расписание живёт только пока открыта эта сессия Claude Code и истекает через
   7 дней; после перезапуска сессии нужен `/devcycle resume`.

## resume

1. Выполни `node scripts/devcycle.mjs state get --json`.
2. Выполни CronList.
3. Если `enabled=true` и расписания нет, создай его заново (как в `start`), запиши новый
   cronId через `node scripts/devcycle.mjs state enable --cron-id <id>`.
4. Если `enabled=true` и расписание есть, ничего не создавай, скажи «расписание на месте».
5. Если `enabled=false`, не запускай молча: спроси владельца, продолжать ли цикл.

## stop

1. Удали расписание: CronDelete по сохранённому `cronId` из `state get`.
2. Если `cronId` нет или такого расписания в CronList не оказалось, найди в CronList
   расписание с промптом `/devcycle tick` и удали его. Если не нашлось ни одного, скажи прямо:
   «расписание не найдено, цикл мог быть уже остановлен».
3. Выполни `node scripts/devcycle.mjs state disable --reason "<причина>"`.
4. Выполни `node scripts/devcycle.mjs report` и отдай отчёт владельцу.
5. Остановись: новых тиков не запускай.

## tick

1. Выполни `node scripts/devcycle.mjs tick`. Код 3 означает пропуск: цикл выключен или
   lock занят другим тиком. В этом случае допиши строку в лог и закончи тик, ничего не делая.
2. При коде 0 выполни инструкцию одного тика из `docs/dev-cycle/tick.md`: квота LoopX,
   состояние PR/CI/сессий, ровно одно действие по первому подходящему случаю, проверка
   результата по первоисточникам.
3. В конце допиши итог: `node scripts/devcycle.mjs log "<время> <что увидел> <что сделал>"`.

## report

1. Выполни `node scripts/devcycle.mjs report`.
2. Отдай владельцу одним сообщением: последние решения, открытые PR с состоянием CI,
   смерженное за сутки. Ничего не меняй.

## Ограничения

- Не правь `BACKLOG.md`, `CHANGELOG.md` и код в этой команде: изменения делает исполнитель
  в отдельном worktree, контролёр проверяет и мержит.
- Не вызывай `loopx quota should-run` из `status`: это фиксация хода. Проба использует
  `loopx turn plan`.
- Push, PR и merge делает контролёр по правилам `docs/dev-cycle/rules.md`.
