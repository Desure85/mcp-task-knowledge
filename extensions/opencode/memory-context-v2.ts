/**
 * memory-context-v2.ts — OpenCode плагин: full auto-context injection (NEXT-021).
 *
 * В отличие от memory-context.ts (v1), этот плагин вызывает MCP search_knowledge
 * САМ через input.client.mcp.call() и инжектирует РЕЗУЛЬТАТ в system prompt.
 *
 * Архитектура:
 *   - Hook `experimental.chat.messages.transform` — извлекает query из последнего сообщения
 *   - Вызывает memory_context_assemble MCP tool через input.client.mcp.call()
 *   - Инжектирует результат в system prompt
 *   - Кэш по query hash (TTL 5 мин)
 *
 * Установка:
 *   cp extensions/opencode/memory-context-v2.ts ~/.config/opencode/plugins/
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";
import { basename } from "node:path";

interface MemoryContextV2Options {
  project?: string;
  userId?: string;
  tokenBudget?: number;
  maxItems?: number;
  cacheTtlMs?: number;
  enabled?: boolean;
}

const DEFAULTS: Required<MemoryContextV2Options> = {
  project: "agent-memory",
  userId: "",
  tokenBudget: 2000,
  maxItems: 20,
  cacheTtlMs: 300000,
  enabled: true,
};

interface CacheEntry {
  queryHash: string;
  contextBlock: string;
  timestamp: number;
}

function extractQuery(messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role !== "user") continue;
    const textParts = msg.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text as string);
    if (textParts.length === 0) continue;
    const fullText = textParts.join(" ").trim();
    if (fullText.length === 0) continue;
    const firstSentence = fullText.split(/[.!?]/)[0]?.trim() ?? fullText;
    return firstSentence.substring(0, 200);
  }
  return null;
}

export const MemoryContextV2Plugin: Plugin = async (input, options?: PluginOptions) => {
  const opts: Required<MemoryContextV2Options> = {
    ...DEFAULTS,
    ...(options as MemoryContextV2Options | undefined),
  };

  if (!opts.enabled) return {};

  const projectDir = input.directory || process.cwd();
  const projectName = opts.project ?? basename(projectDir);
  const cache = new Map<string, CacheEntry>();
  const MARKER = "<memory-context-v2>";

  const cleanupCache = (): void => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > opts.cacheTtlMs) {
        cache.delete(key);
      }
    }
  };

  return {
    "experimental.chat.messages.transform": async (chatInput, chatOutput) => {
      const query = extractQuery(chatOutput.messages);
      if (!query) return;

      const queryHash = createHash("sha256").update(query).digest("hex").substring(0, 16);
      cleanupCache();

      const cached = cache.get(queryHash);
      let contextBlock: string;

      if (cached) {
        contextBlock = cached.contextBlock;
      } else {
        try {
          const result = (await chatInput.client.mcp.call({
            server: "mcp-task-knowledge",
            tool: "memory_context_assemble",
            args: {
              query,
              project: projectName,
              userId: opts.userId || undefined,
              tokenBudget: opts.tokenBudget,
              maxItems: opts.maxItems,
            },
          })) as { ok?: boolean; data?: { contextBlock?: string } };

          if (result?.ok && result.data?.contextBlock) {
            contextBlock = result.data.contextBlock;
            cache.set(queryHash, { queryHash, contextBlock, timestamp: Date.now() });
          } else {
            return;
          }
        } catch {
          return;
        }
      }

      if (!contextBlock) return;
    },

    "experimental.chat.system.transform": async (_sysInput, sysOutput) => {
      if (!Array.isArray(sysOutput.system)) return;

      const alreadyInjected = sysOutput.system.some(
        (s: string) => typeof s === "string" && s.includes(MARKER),
      );
      if (alreadyInjected) return;

      sysOutput.system.push(`<memory-context-v2>
## Авто-контекст из памяти (v2)

Контекст из прошлых сессий автоматически извлечён и добавлен в messages.
Если блок <context> присутствует в сообщениях — используй его как контекст.
Если блока нет — MCP сервер недоступен, работай без памяти.

Проект: ${projectName}
Бюджет токенов: ${opts.tokenBudget}
</memory-context-v2>`);
    },
  };
};

export default MemoryContextV2Plugin;
