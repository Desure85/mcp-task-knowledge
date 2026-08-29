# ADR-006: Claude Code Plugin Compatibility — bidirectional converter

- **Статус:** Proposed (2026-08-29, night research)
- **Область:** src/skills/, src/rules/

## Контекст

Claude Code (code.claude.com) представил систему плагинов:

- `skills/<name>/SKILL.md` — скилы (YAML frontmatter + инструкции)
- `.claude-plugin/plugin.json` — манифест (name, description, version)
- `agents/` — кастомные агенты
- `hooks/hooks.json` — event handlers
- `.mcp.json` — MCP-сервер конфигурация
- `monitors/` — фоновые мониторы
- Маркетплейс для дистрибуции

mcp-task-knowledge уже имеет:

- Skills (SK-001..006): собственный формат, Markdown + YAML frontmatter
- Rules (RL-001..006): guard rules с enforcement
- Workflows (WF-001..006): AI workflow execution
- Memory (MEM-002..004): entity graph, distillation

Форматы **близки, но не идентичны**:

- Наши skills: `data/prompts/<project>/sources/skills/<name>.json` + экспорт в Markdown
- Claude Code: `skills/<name>/SKILL.md` (Markdown с frontmatter)
- У нас уже есть SK-005 (converters из .cursorrules/SKILL.md/.clinerules)

## Решение

**Двунаправленный конвертер** в src/skills/:

1. **Export → Claude Code plugin**: `prompts_export_plugin` инструмент
   - Читает наши skills из storage
   - Генерирует `skills/<name>/SKILL.md` + `.claude-plugin/plugin.json`
   - Упаковывает в директорию (или .zip)
   - Namespace: `mcp-task-knowledge:<skill-name>`

2. **Import ← Claude Code plugin**: `prompts_import_plugin` инструмент
   - Читает `.claude-plugin/plugin.json` + `skills/*/SKILL.md`
   - Конвертирует в наш формат (JSON source + Markdown export)
   - Сохраняет в `data/prompts/<project>/sources/skills/`

3. **Rules → hooks**: опционально, конвертация guard rules в `hooks/hooks.json`

## Последствия

- Плюс: пользователи Claude Code могут установить наш plugin из маркетплейса
- Плюс: мы можем импортировать community-скилы
- Плюс: SK-005 converters уже частично делают это
- Минус: не все наши фичи (workflows, memory) маппятся 1:1 — только skills/rules
