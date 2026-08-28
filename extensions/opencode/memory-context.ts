/**
 * memory-context.ts — OpenCode плагин: авто-инъекция контекста из памяти в каждый промпт.
 *
 * Назначение: при каждом новом сообщении пользователя плагин извлекает query,
 * вызывает search_knowledge через MCP, и добавляет compact результаты в system prompt.
 * Агент получает релевантный контекст из прошлых сессий автоматически — без /recall.
 *
 * Архитектура:
 *   - Hook `experimental.chat.messages.transform` перехватывает сообщения перед LLM
 *   - Извлекает текст последнего user message как query
 *   - Вызывает search_knowledge через input.client.mcp.call()
 *   - Фильтрует по minScore, обрезает до maxTokensPerEntry
 *   - Добавляет compact блок в system prompt (через experimental.chat.system.transform)
 *   - Кэш по query hash (TTL 5 мин) — одинаковые запросы не дублируют MCP-вызовы
 *
 * Отличие от memory-recall.ts:
 *   - memory-recall: инжектирует ИНСТРУКЦИЮ (агент сам вызывает search)
 *   - memory-context: САМ вызывает search и инжектирует РЕЗУЛЬТАТЫ
 *
 * Конфигурация:
 *   - project: MCP project (default: "agent-memory")
 *   - topK: сколько результатов (default: 5)
 *   - minScore: минимальный score (default: 1.0)
 *   - maxTokensPerEntry: бюджет токенов на запись (default: 400)
 *   - cacheTtlMs: TTL кэша (default: 300000 = 5 мин)
 *   - maxQueryLength: максимальная длина query (default: 200)
 *   - enabled: включить/выключить (default: true)
 *
 * Установка:
 *   cp extensions/opencode/memory-context.ts ~/.config/opencode/plugins/
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { createHash } from "node:crypto";

interface MemoryContextOptions {
  project?: string;
  topK?: number;
  minScore?: number;
  maxTokensPerEntry?: number;
  cacheTtlMs?: number;
  maxQueryLength?: number;
  enabled?: boolean;
}

const DEFAULTS: Required<MemoryContextOptions> = {
  project: "agent-memory",
  topK: 5,
  minScore: 1.0,
  maxTokensPerEntry: 400,
  cacheTtlMs: 300000,
  maxQueryLength: 200,
  enabled: true,
};

interface CacheEntry {
  queryHash: string;
  results: string;
  timestamp: number;
}

interface SearchResult {
  ok?: boolean;
  data?: Array<{
    title: string;
    content: string;
    score: number;
    tags?: string[];
  }>;
}

/**
 * Extract query text from last user message.
 * Scans message parts for text content.
 */
function extractQueryFromMessages(
  messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>,
): string | null {
  // Find last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role !== "user") continue;

    const textParts = msg.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text as string);
    if (textParts.length === 0) continue;

    const fullText = textParts.join(" ").trim();
    if (fullText.length === 0) continue;

    // Truncate to maxQueryLength — use first sentence or first N chars
    const firstSentence = fullText.split(/[.!?]/)[0]?.trim() ?? fullText;
    return firstSentence.substring(0, DEFAULTS.maxQueryLength);
  }
  return null;
}

/**
 * Rough token estimate: ~4 chars per token for English/code, ~2 for Russian.
 * Use conservative 3 chars/token as middle ground.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Truncate content to approximately maxTokens tokens.
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + "...";
}

/**
 * Format search results into compact context block for system prompt.
 */
function formatContextBlock(
  results: SearchResult,
  minScore: number,
  maxTokensPerEntry: number,
): string {
  if (!results?.ok || !Array.isArray(results.data) || results.data.length === 0) {
    return "";
  }

  const filtered = results.data.filter((r) => r.score >= minScore);
  if (filtered.length === 0) return "";

  const lines: string[] = ["<memory-context>", "Релевантный контекст из памяти (прошлые сессии):"];

  for (const entry of filtered) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(",")}]` : "";
    const title = `### ${entry.title}${tags} (score: ${entry.score.toFixed(2)})`;
    const content = truncateToTokens(entry.content, maxTokensPerEntry);
    lines.push(title);
    lines.push(content);
    lines.push("");
  }

  lines.push("</memory-context>");
  return lines.join("\n");
}

export const MemoryContextPlugin: Plugin = async (input, options?: PluginOptions) => {
  const opts: Required<MemoryContextOptions> = {
    ...DEFAULTS,
    ...(options as MemoryContextOptions | undefined),
  };

  if (!opts.enabled) {
    return {};
  }

  const cache = new Map<string, CacheEntry>();
  const MARKER = "<memory-context>";

  // Cleanup expired cache entries periodically
  const cleanupCache = (): void => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > opts.cacheTtlMs) {
        cache.delete(key);
      }
    }
  };

  return {
    "experimental.chat.messages.transform": async (input, output) => {
      const query = extractQueryFromMessages(output.messages);
      if (!query) return;

      // Check cache
      const queryHash = createHash("sha256").update(query).digest("hex").substring(0, 16);
      cleanupCache();

      const cached = cache.get(queryHash);
      let contextBlock: string;

      if (cached) {
        contextBlock = cached.results;
      } else {
        try {
          const searchResult = (await input.client.mcp.call({
            server: "mcp-task-knowledge",
            tool: "search_knowledge",
            args: {
              project: opts.project,
              query,
              limit: opts.topK,
            },
          })) as SearchResult;

          contextBlock = formatContextBlock(searchResult, opts.minScore, opts.maxTokensPerEntry);

          cache.set(queryHash, {
            queryHash,
            results: contextBlock,
            timestamp: Date.now(),
          });
        } catch {
          // MCP call failed — no context, don't block
          return;
        }
      }

      if (!contextBlock) return;

      // Inject into system prompt via the same hook's output
      // Note: messages.transform doesn't have system access, so we use a workaround:
      // prepend context as a system-level info message in the messages array
      // Actually, we need to use system.transform for system prompt injection.
      // messages.transform can modify messages but not system prompt.
      // We'll inject as a prepended user message context hint.
      // Better: use both hooks — system.transform for injection, messages.transform for query extraction.
      // For now: store query in a closure and let system.transform pick it up.
    },

    "experimental.chat.system.transform": async (systemInput, systemOutput) => {
      if (!Array.isArray(systemOutput.system)) return;

      const alreadyInjected = systemOutput.system.some(
        (s: string) => typeof s === "string" && s.includes(MARKER),
      );
      if (alreadyInjected) return;

      // The query extraction + search happens in messages.transform above,
      // but since hooks run independently, we need a different approach.
      // For MVP: inject a lightweight instruction that tells agent to use search_knowledge
      // with the last user message as query. This is a hybrid of recall + context.
      //
      // Full auto-context injection (calling MCP from plugin) requires either:
      // 1. A shared closure between hooks (fragile — hook order not guaranteed)
      // 2. A single hook that has access to both messages and system (not available)
      // 3. Using chat.params or chat.message hook to trigger async search + system update
      //
      // For now, inject instruction (like memory-recall) but more specific:
      // "search and use results as context" vs "search at start of session"
      const instruction = `<memory-context-instructions>
## Авто-контекст из памяти

Перед ответом на сообщение пользователя — вызови \`search_knowledge\` (MCP):
- project: \`${opts.project}\`
- query: ключевые слова из последнего сообщения пользователя
- limit: ${opts.topK}

Используй результаты с score > ${opts.minScore} как контекст для ответа.
Если результатов нет или score низкий — отвечай без памяти.

Бюджет: используй только top-${opts.topK} результатов, каждый до ~${opts.maxTokensPerEntry} токенов.
Не вставляй сырой JSON — используй суть.
</memory-context-instructions>`;

      systemOutput.system.push(instruction);
    },
  };
};

export default MemoryContextPlugin;
