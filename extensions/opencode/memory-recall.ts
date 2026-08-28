/**
 * memory-recall.ts — OpenCode плагин: авто-вызов search_knowledge в начале сессии.
 *
 * Назначение: агент автоматически получает релевантный контекст из mcp-task-knowledge
 * (memory backend) без явного /recall. Плагин инжектирует инструкцию в системный
 * промпт — агент сам вызывает `search_knowledge` через MCP в начале работы.
 *
 * Архитектура (как session-draft.ts):
 *   - Плагин НЕ вызывает MCP напрямую (нет ctx.mcp.call в OpenCode Plugin API).
 *   - Плагин инжектирует инструкцию в system prompt через `experimental.chat.system.transform`.
 *   - Агент читает инструкцию и вызывает `mcp1_search_knowledge` / `search_knowledge`
 *     через MCP-инструменты, доступные в сессии.
 *
 * Конфигурация (через opencode.json plugin options):
 *   - project: MCP project name (default: "agent-memory")
 *   - topK: сколько результатов искать (default: 5)
 *   - minScore: минимальный score для инъекции (default: 1.0)
 *   - enabled: включить/выключить плагин (default: true)
 *
 * Установка:
 *   1. Скопировать файл в ~/.config/opencode/plugins/memory-recall.ts
 *   2. Файлы из ~/.config/opencode/plugins/ подхватываются при старте OpenCode.
 *   3. Регистрация в opencode.json не требуется (auto-discovery).
 *
 * Альтернатива (npm-пакет):
 *   "plugin": ["@mcp-task-knowledge/memory-recall"]
 *
 * Загрузка: файлы из ~/.config/opencode/plugins/ подхватываются при старте.
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

interface MemoryRecallOptions {
  project?: string;
  topK?: number;
  minScore?: number;
  enabled?: boolean;
}

const DEFAULTS: Required<MemoryRecallOptions> = {
  project: "agent-memory",
  topK: 5,
  minScore: 1.0,
  enabled: true,
};

const buildRecallInstructions = (
  project: string,
  topK: number,
  minScore: number,
  sessionId: string | undefined,
): string => {
  return `<memory-recall-instructions>
## Автоматический recall из памяти (mcp-task-knowledge)

У тебя есть доступ к MCP-серверу \`mcp-task-knowledge\` — это твой memory backend.
В нём хранятся факты, паттерны и решения из прошлых сессий (project: \`${project}\`).

### Что делать в начале сессии

1. **Сразу после получения первого сообщения пользователя** — вызови MCP-инструмент
   \`mcp1_search_knowledge\` (или \`search_knowledge\`) с параметрами:
   - \`project\`: \`${project}\`
   - \`query\`: извлеки ключевые слова из сообщения пользователя (или контекст задачи)
   - \`limit\`: ${topK}

2. **Проанализируй результаты**: если есть записи с \`score > ${minScore}\` —
   используй их как контекст. Это проверенные факты из прошлых сессий, они могут
   сэкономить тебе шаги исследования.

3. **Не блокируй работу на recall**: если MCP-вызов не отвечает или вернул пусто —
   продолжай работу без памяти. Recall — это ускорение, не блокер.

### Когда делать recall дополнительно

- Перед сложной задачей (рефакторинг, дебаг, архитектурное решение) — поищи
  релевантные факты, вдруг уже есть опыт.
- Если пользователь упоминает технологию/модуль/домен — поищи, есть ли факты об этом.
- После правок пользователя («нет, не так») — поищи, вдруг это уже исправляли.

### Что НЕ делать

- НЕ вызывай recall на каждое сообщение — только в начале и при смене контекста.
- НЕ вставляй сырой JSON результатов в ответ пользователю — используй как контекст.
- НЕ делай recall если MCP-сервер \`mcp-task-knowledge\` не доступен (enabled=false в конфиге).

### Формат результатов search_knowledge

MCP-инструмент вернёт массив записей. Каждая запись:
- \`title\`: заголовок факта
- \`content\`: содержимое (может быть длинным)
- \`score\`: релевантность (выше = лучше)
- \`tags\`: теги (fact, pattern, decision, suspicious, process)

Используй только записи с \`score > ${minScore}\`. Если все ниже — игнорируй, работай
с нуля.

### Session ID (для отладки)

Твоя сессия: ${sessionId ?? "unknown"}. Если recall работает медленно или странно —
упомяни session ID в draft для отладки.

### Связь с /remember и /end-session

- \`/remember\` — записывает новый факт в facts.md (файл), НЕ в mcp-task-knowledge.
- Sync facts.md → mcp-task-knowledge происходит через \`/memory-sync\` или \`/end-session\`.
- Этот плагин (memory-recall) — только чтение (search), не запись.
- Полный цикл: recall (чтение) → работа → remember (запись в facts.md) → sync (в index).
</memory-recall-instructions>`;
};

export const MemoryRecallPlugin: Plugin = async (_input, options?: PluginOptions) => {
  const opts: Required<MemoryRecallOptions> = {
    ...DEFAULTS,
    ...(options as MemoryRecallOptions | undefined),
  };

  if (!opts.enabled) {
    return {};
  }

  const MARKER = "<memory-recall-instructions>";

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (!Array.isArray(output.system)) return;

      const alreadyInjected = output.system.some(
        (s: string) => typeof s === "string" && s.includes(MARKER),
      );
      if (alreadyInjected) {
        return;
      }

      output.system.push(
        buildRecallInstructions(opts.project, opts.topK, opts.minScore, input.sessionID),
      );
    },
  };
};

export default MemoryRecallPlugin;
