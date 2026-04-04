# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- AGENTS.md: трекинг-тройка → трекинг-пара (AGENTS.md + BACKLOG.md). ROADMAP.md → legacy.
- BACKLOG.md: новая структура — «Стратегия» (бывший ROADMAP) + «Очередь» + «Блокированные» + «Архив».
- .gitignore: добавлена секция `.session/` для журналов сессий агента.

### Added

- AGENTS.md §3: протоколы воркфлоу — Session ID, checkpoint-коммиты, 3-фазный цикл (Исследование → План → Реализация), правило одной задачи, pre-PR чеклист, rollback-протокол, handoff через коммиты, правило 30 минут, журнал сессии.
- AGENTS.md §4: итоговая последовательность сессии (12 шагов).
- CHANGELOG.md: журнал изменений по формату Keep a Changelog.

## [1.0.20] - 2025-09-27

### Added

- Initial agent tracking files (AGENTS.md, BACKLOG.md, updated ROADMAP.md).
- Market research report (MARKET-RESEARCH.md) with competitive analysis of 20 MCP servers.
- Backlog restructured into 4 sprints based on market demand.
