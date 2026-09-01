/**
 * memory-dream.ts — OpenCode плагин: background memory refinement (NEXT-019).
 *
 * Sleep-time compute: idle detection → dedup/merge/summarise facts.md → MCP sync.
 * Расширение memory-sync.ts с dreaming capabilities.
 *
 * Архитектура:
 *   - Hook `experimental.chat.system.transform` — инжектирует инструкцию
 *   - Агент сам вызывает memory_dream MCP tool в конце сессии или при idle
 *   - Плагин НЕ вызывает MCP сам — он инструктирует агента
 *
 * Установка:
 *   cp extensions/opencode/memory-dream.ts ~/.config/opencode/plugins/
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

interface MemoryDreamOptions {
  enabled?: boolean;
  autoDream?: boolean;
}

const DEFAULTS: Required<MemoryDreamOptions> = {
  enabled: true,
  autoDream: true,
};

const buildDreamInstructions = (): string => {
  return `<memory-dream-instructions>
## Sleep-time Memory Refinement (NEXT-019)

В конце сессии (перед /end-session) — вызови \`memory_dream\` (MCP):
- action: "run" (one cycle of dedup/merge/promote)
- Это очистит дубликаты, объединит похожие факты, промоутит conversation→session

### Когда вызывать

- Перед /end-session — очистить память после активной сессии
- После большого объёма /remember — если было 5+ новых фактов
- НЕ вызывай на каждое сообщение — только в конце или при накоплении фактов

### Что делает dreaming

1. Dedup: находит факты с Jaccard similarity ≥ 0.8, инвалидирует дубликаты
2. Merge: находит факты с similarity 0.5-0.8, объединяет в один
3. Promote: переносит conversation layer → session layer
4. Temporal dedup: проверяет temporal graph на дубликаты

### Связь с другими плагинами

- memory-extract.ts: извлекает факты (NEXT-020)
- memory-sync.ts: синхронизирует facts.md → MCP (OC-002)
- memory-dream.ts: ОЧИЩАЕТ память после извлечения и синхронизации (NEXT-019)
- memory-profile.ts: поддерживает профиль пользователя (NEXT-022)

Порядок: extract → sync → dream → profile update
</memory-dream-instructions>`;
};

export const MemoryDreamPlugin: Plugin = async (_input, options?: PluginOptions) => {
  const userOpts = options as MemoryDreamOptions | undefined;

  if (userOpts?.enabled === false) {
    return {};
  }

  const MARKER = "<memory-dream-instructions>";

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!Array.isArray(output.system)) return;

      const alreadyInjected = output.system.some(
        (s: string) => typeof s === "string" && s.includes(MARKER),
      );
      if (alreadyInjected) return;

      output.system.push(buildDreamInstructions());
    },
  };
};

export default MemoryDreamPlugin;
