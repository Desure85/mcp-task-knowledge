# Architecture

> Mermaid-диаграммы ключевых компонентов (D-005). Обновлять при изменении архитектуры.

## Компоненты и поток данных

```mermaid
flowchart LR
    Client[["MCP Client<br/>(Claude/Cursor/VS Code)"]] -->|stdio / HTTP / TCP / WS| Transport

    subgraph Transport["Transport Layer (src/transport)"]
        Transport[TransportAdapter<br/>stdio · http · stream · relay]
        Registry[TransportRegistry]
    end

    Transport --> AppContainer["AppContainer<br/>(src/core/app-container.ts)<br/>lifecycle: init → start → stop"]
    AppContainer --> Ctx["ServerContext<br/>(src/register/context.ts)"]
    AppContainer --> HC["HealthChecker<br/>app · transport · embeddings · catalog"]

    Ctx --> Executor["ToolExecutor<br/>(src/core/tool-executor.ts)<br/>middleware pipeline + hooks"]
    Executor --> MW["Middleware<br/>ACL · rate-limit · input-sanitize · error-handler"]
    Executor --> Tools["Tool Handlers<br/>(src/register/*.ts)"]

    Tools --> Storage["Storage<br/>tasks · knowledge · prompts"]
    Tools --> Search["Search<br/>BM25 · vector (ONNX)"]
    Tools --> Catalog["Service Catalog<br/>embedded/remote/hybrid"]
    Tools --> Relay["LAN Relay (BM-012)<br/>WS + AES-256-GCM"]
    Tools --> Behavioral["Behavioral Memory<br/>intents · failures · resolutions"]

    Storage --> Files[("Markdown/JSON files<br/>DATA_DIR")]
    Search --> BM25[BM25 index]
    Search --> Vectors[(Vector cache)]

    EventBus["EventBus<br/>(src/core/event-bus.ts)"] -.->|server.started/stopped| AppContainer
    Relay -.->|relay.rule.broadcast| EventBus
```

## Жизненный цикл запроса

```mermaid
sequenceDiagram
    participant C as MCP Client
    participant T as TransportAdapter
    participant E as ToolExecutor
    participant M as Middleware Pipeline
    participant H as Tool Handler
    participant S as Storage/Search

    C->>T: JSON-RPC request (Content-Length framing)
    T->>E: execute(toolName, input, context)
    E->>M: before(ctx) hooks (forward)
    M-->>E: shortCircuit? | deny?
    E->>H: handler(input, context)
    H->>S: read/write data
    S-->>H: result
    H-->>E: { ok: true, data }
    E->>M: after(ctx, result) hooks (reverse)
    M-->>E: final result
    E-->>T: response envelope
    T-->>C: JSON-RPC response

    Note over E,M: onError: error-handler middleware<br/>classifies + logs, then re-throw
```

## Слои и зависимости

```mermaid
flowchart TD
    Register["src/register/* — регистрация инструментов"] --> Core["src/core/* — AppContainer, ToolExecutor, middleware, session, auth"]
    Register --> Storage["src/storage/*"]
    Register --> Search["src/search/*"]
    Register --> Rules["src/rules/*"]
    Register --> Workflows["src/workflows/*"]
    Register --> Skills["src/skills/*"]
    Register --> Behavioral["src/behavioral/*"]
    Register --> Relay["src/relay/*"]

    Core --> Utils["src/utils/* — respond, fs"]
    Storage --> Utils
    Search --> Utils
    Relay --> Core

    subgraph Infra["Infrastructure"]
        Core --> DB["src/db/* — SQLite migrations (BM-013)"]
        Core --> Health["src/health/*"]
        Core --> Audit["src/audit/*"]
        Proxy["src/proxy/*"] --> Core
    end
```

## Ключевые решения

| Решение | Где | Почему |
|---|---|---|
| Middleware pipeline (MW-001) | `src/core/middleware.ts` | onError может только swallow или re-throw оригинал; нормализация — в ErrorHandler (TD-010) |
| Атомарная запись JSON | `src/fs.ts` writeJson | tmp+rename защищает от ENOSPC/крэша (Q-013) |
| ServiceAvailability singleton | `src/core/graceful-degradation.ts` | health-чеки embeddings/catalog видят реальные сбои (AI-009) |
| LAN Relay zero-dep discovery | `src/relay/discovery.ts` | UDP multicast вместо mDNS-библиотеки (BM-012) |
| Type-check тестов | `tsconfig.test.json` | tests/** включены в tsc, моки проверяются satisfies (TD-012, Q-012) |
