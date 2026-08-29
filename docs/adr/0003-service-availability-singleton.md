# ADR-003: ServiceAvailability — process-wide singleton registry

- **Статус:** Accepted (2026-08-29, AI-009)
- **Область:** src/core/graceful-degradation.ts

## Контекст

TD-011 ввёл ServiceAvailabilityRegistry для трекинга optional-сервисов
(embeddings, catalog). Health-чеки в AppContainer читали реестр, но
инструменты (search) не могли записывать recordFailure — реестр не был
доступен из register/search.ts, а прокидывать через ServerContext значило
сломать 20+ моков в тестах.

## Решение

Процессный singleton по паттерну metrics.ts:

```ts
export function getServiceAvailabilityRegistry(): ServiceAvailabilityRegistry {
  if (!_registry) _registry = new ServiceAvailabilityRegistry();
  return _registry;
}
```

AppContainer и инструменты используют один и тот же экземпляр.
`hybridSearch` получил опциональный `onVectorError` callback, который
инструменты связывают с `recordFailure()`.

## Последствия

- Плюс: health-чеки видят реальные сбои (embeddings degrade на настоящих ошибках)
- Плюс: ноль изменений ServerContext/моков
- Минус: глобальное состояние (как metrics) — тесты должны сбрасывать через `_resetServiceAvailabilityRegistry()`
