# ADR-001: Middleware onError contract — swallow via return, not throw

- **Статус:** Accepted (2026-08-28, TD-010)
- **Область:** src/core/middleware.ts

## Контекст

При создании centralized error handling (TD-010) возникла потребность
нормализовать ошибки в onError-хуках middleware. Наивный подход — бросить
нормализованный ToolError из onError.

## Решение

`MiddlewarePipeline.runErrorHooks` (middleware.ts:362-400) устроен так:
если onError-хук **бросает**, pipeline ловит это как hook-error (логирует
и пропускает) и в итоге пере-бросает **ОРИГИНАЛЬНУЮ** ошибку. Трансформация
через re-throw невозможна по дизайну.

Поэтому:

- onError может только **swallow** (вернуть fallback-значение) или **не мешать** (вернуть undefined)
- нормализация ошибок происходит на этапе построения ответа: `ErrorHandler` / `toErrorResponse()`
- `createErrorHandlerMiddleware()` логирует с контекстом и возвращает undefined

## Последствия

- Плюс: единая точка классификации (ErrorCategory/ErrorResponse), стабильный контракт
- Минус: middleware не может подменить ошибку — только наблюдать или глотать
