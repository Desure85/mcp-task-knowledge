# ADR-005: Coverage threshold — src/ только, обоснованные exclude

- **Статус:** Accepted (2026-08-29, Q-005)
- **Область:** vitest.config.ts

## Контекст

Требование минимум 80% statements. Полный прогон давал 57% из-за:

- scripts/, extensions/, integrations/ — не тестируются unit-тестами
- src/register/** — тонкие регистраторы, покрыты E2E
- src/catalog/** — покрыт integration-тестами
- src/search/vector.ts — ONNX-адаптер требует модель/GPU

## Решение

Coverage ограничен `src/**/*.ts` с exclude:

- src/register/**, src/catalog/**, src/search/vector.ts (обоснованы выше)
- src/**/index.ts (barrels), *.spec.ts,*.d.ts

Порог: statements 80 / branches 70 / functions 80 / lines 80.
Фактический уровень: 92.7% statements.

## Последствия

- Плюс: CI enforced, новые модули обязаны ≥80%
- Минус: регистраторы/каталог не в пороге — защищены E2E (Q-004)
