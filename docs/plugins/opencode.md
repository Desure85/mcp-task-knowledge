# OpenCode plugin suite — единственный источник правды

Этот документ фиксирует состав «комплекта» OpenCode-плагинов и скриптов, которые раньше жили в
разных местах (`~/.config/opencode/plugins`, `~/.config/opencode/scripts`, `~/work/ci-agent`).
Канонический источник — `extensions/opencode/` в этом репозитории; живые копии — установочные, а не
место разработки.

## Состав

| Файл | Назначение |
|------|------------|
| `memory-recall.ts`, `memory-context.ts`, `memory-context-v2.ts`, `memory-dream.ts`, `memory-extract.ts`, `memory-profile.ts` | Память агента: recall/context/extract/profile/dream (MCP-инструкции + hooks). |
| `memory-sync.ts` | `/memory-sync`: `facts.md`/`patterns.json` → knowledge base, hash-state. |
| `session-draft.ts` | Напоминание агенту вести `draft-<session>.md` (саморефлексия для `/end-session`). |
| `scripts/collect-subagent-drafts.sh` | Сбор драфтов текущей сессии и всех её сабагентов из `opencode.db` (`--list`/`--out`). |
| `commands/end-session.md` | Ритуал завершения: quick snapshot → draft consolidation (дедуп/классификация) → facts/patterns. |

## Инвентаризация (2026-11-10, read-only)

Хэши — первые 12 символов SHA-256; даты — mtime файла. «Репозиторий» — `extensions/opencode/`.

| Файл | Репозиторий | Живой `~/.config/opencode` | `~/work/ci-agent` |
|------|-------------|----------------------------|-------------------|
| `memory-context.ts` | 9 876 B, 2026-11-08, `3A7AED764627` | нет | нет |
| `memory-context-v2.ts` | 4 987 B, 2026-11-08, `DD689E339A52` | нет | нет |
| `memory-dream.ts` | 3 356 B, 2026-11-08, `21F29D432803` | нет | нет |
| `memory-extract.ts` | 4 844 B, 2026-11-08, `973163F37B60` | нет | нет |
| `memory-profile.ts` | 4 916 B, 2026-11-08, `5372908BAE92` | нет | нет |
| `memory-recall.ts` | 7 837 B, 2026-11-08, `C53406847A24` | нет | 6 274 B, 2026-09-02 |
| `memory-sync.ts` | 13 758 B, 2026-11-08, `581BAB780437` | 5 798 B, 2026-08-28, `56788D9A2443` | 15 855 B, 2026-09-02 |
| `session-draft.ts` | 15 152 B, 2026-09-02 (перенесён из ci-agent) | 11 924 B, 2026-08-20, `AC6AC655D3A6` | 15 152 B, 2026-09-02, `F740935CA014` |
| `scripts/collect-subagent-drafts.sh` | 5 701 B, `DA2028931F9A` | `~/.config/opencode/scripts/` отсутствует | 5 701 B, `DA2028931F9A` |
| `commands/end-session.md` | 18 912 B, `56600F01B07F` | нет (команда была только в ci-agent) | 18 912 B, `56600F01B07F` |

`loopx-goal.js` в живом каталоге — отдельный плагин LoopX, в комплект памяти не входит и здесь не
учитывается.

## Расхождения и решение

| Файл | Расхождение | Причина | Решение |
|------|-------------|---------|---------|
| `memory-context.ts`, `memory-context-v2.ts`, `memory-dream.ts`, `memory-extract.ts`, `memory-profile.ts`, `memory-recall.ts` | живых копий нет | комплект ставился выборочно; репозиторий развивался отдельно | канон — репозиторий; установка — копированием из `extensions/opencode/` (см. ниже). Это объясняет пустой diff: сравнивать не с чем. |
| `memory-sync.ts` | три версии: repo 13 758 B (2026-11-08), live 5 798 B (2026-08-28), ci-agent 15 855 B (2026-09-02) | live — ранняя версия; ci-agent — отдельная ветка с `MCP_KNOWLEDGE_URL`/`mcpCall`; repo — текущая линия с новым MCP-клиентом | канон — repo. Живую копию обновить копированием repo-файла; ci-agent-вариант не переносится, его `mcpCall`-подход зафиксирован здесь как отклонение, а не как скрытая альтернатива. |
| `session-draft.ts` | live 11 924 B (2026-08-20) vs repo/ci-agent 15 152 B (2026-09-02) | live-копия устарела; ci-agent-версия новее | в репозиторий перенесена версия ci-agent (15 152 B); live обновить копированием. |
| `collect-subagent-drafts.sh` | живой `scripts/` пуст | скрипт жил в ci-agent | перенесён в `extensions/opencode/scripts/`; установка — копирование в `~/.config/opencode/scripts/`. |
| `end-session.md` | в live нет | команда жила в ci-agent | перенесена в `extensions/opencode/commands/`; установка — копирование в `~/.config/opencode/commands/`. |

## Установка (живые копии)

```bash
# плагины
cp extensions/opencode/*.ts ~/.config/opencode/plugins/

# сборщик драфтов и команда завершения
mkdir -p ~/.config/opencode/scripts ~/.config/opencode/commands
cp extensions/opencode/scripts/collect-subagent-drafts.sh ~/.config/opencode/scripts/
cp extensions/opencode/commands/end-session.md ~/.config/opencode/commands/
```

После установки `diff -u extensions/opencode/<name>.ts ~/.config/opencode/plugins/<name>.ts` должен
быть пустым; расхождения допустимы только при записи в разделе «Расхождения» выше.

## Проверка

- `git ls-files extensions/opencode` содержит все 7 плагинов, `session-draft.ts`, скрипт и команду.
- `tests/plugins-inventory.test.ts` проверяет, что каждый файл комплекта отслеживается, а таблица
  расхождений содержит все имена (удаление строки из документа/файла красит тест).
