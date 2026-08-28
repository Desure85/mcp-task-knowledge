/**
 * memory-sync.ts — OpenCode плагин: sync facts.md → mcp-task-knowledge после /remember.
 *
 * Назначение: после того как агент записал факт в facts.md (через /remember),
 * плагин автоматически синхронизирует новые/изменённые записи в mcp-task-knowledge
 * knowledge base — без ручного /memory-sync.
 *
 * Архитектура:
 *   - Hook `tool.execute.after` перехватывает завершение команды /remember
 *   - Debounce 30с — если за 30с было несколько /remember, sync один раз
 *   - Читает facts.md, вычисляет hash каждой записи, сравнивает с состоянием
 *   - Новые/изменённые записи → knowledge_bulk_create через MCP
 *   - Прямой MCP-вызов через ctx.client (OpenCode Plugin API client)
 *
 * Конфигурация (через opencode.json plugin options):
 *   - project: MCP project name (default: "agent-memory")
 *   - factsPath: путь к facts.md (default: "~/.omo/memory/facts.md")
 *   - statePath: путь к state-файлу (default: "~/.omo/memory/.sync-state.json")
 *   - debounceMs: debounce задержка (default: 30000)
 *   - enabled: включить/выключить (default: true)
 *
 * Установка:
 *   cp extensions/opencode/memory-sync.ts ~/.config/opencode/plugins/
 *
 * Загрузка: файлы из ~/.config/opencode/plugins/ подхватываются при старте.
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

interface MemorySyncOptions {
  project?: string;
  factsPath?: string;
  statePath?: string;
  debounceMs?: number;
  enabled?: boolean;
}

const DEFAULTS: Required<MemorySyncOptions> = {
  project: "agent-memory",
  factsPath: join(homedir(), ".omo", "memory", "facts.md"),
  statePath: join(homedir(), ".omo", "memory", ".sync-state.json"),
  debounceMs: 30000,
  enabled: true,
};

interface SyncState {
  [hash: string]: {
    title: string;
    syncedAt: string;
    knowledgeId?: string;
  };
}

interface FactsEntry {
  title: string;
  content: string;
  hash: string;
  tags: string[];
}

/**
 * Parse facts.md into structured entries.
 * Expected format: Markdown with ## headings as entry titles.
 * Each ## section is one entry. Content is the body under the heading.
 */
function parseFactsFile(content: string): FactsEntry[] {
  const entries: FactsEntry[] = [];
  const lines = content.split("\n");
  let currentTitle = "";
  let currentBody: string[] = [];
  let inEntry = false;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (inEntry && currentTitle) {
        const bodyText = currentBody.join("\n").trim();
        const hash = createHash("sha256")
          .update(currentTitle + bodyText)
          .digest("hex")
          .substring(0, 16);
        entries.push({
          title: currentTitle,
          content: bodyText,
          hash,
          tags: extractTags(bodyText),
        });
      }
      currentTitle = headingMatch[1].trim();
      currentBody = [];
      inEntry = true;
    } else if (inEntry) {
      currentBody.push(line);
    }
  }

  if (inEntry && currentTitle) {
    const bodyText = currentBody.join("\n").trim();
    const hash = createHash("sha256")
      .update(currentTitle + bodyText)
      .digest("hex")
      .substring(0, 16);
    entries.push({
      title: currentTitle,
      content: bodyText,
      hash,
      tags: extractTags(bodyText),
    });
  }

  return entries;
}

function extractTags(content: string): string[] {
  const tags = new Set<string>();
  const tagMatches = content.match(/#[a-zA-Z0-9_-]+/g);
  if (tagMatches) {
    for (const t of tagMatches) {
      tags.add(t.substring(1).toLowerCase());
    }
  }
  if (content.includes("[pattern]")) tags.add("pattern");
  if (content.includes("[fact]")) tags.add("fact");
  if (content.includes("[decision]")) tags.add("decision");
  if (content.includes("[suspicious]")) tags.add("suspicious");
  if (content.includes("[process]")) tags.add("process");
  return Array.from(tags);
}

function loadState(statePath: string): SyncState {
  try {
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    }
  } catch {
    // corrupt state — start fresh
  }
  return {};
}

function saveState(statePath: string, state: SyncState): void {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {
    // best-effort — don't block agent work
  }
}

/**
 * Extract existing knowledge entry ID from search results if title matches exactly.
 * Used for dedup (OC-003): if entry with same title exists, update instead of create.
 */
function extractExistingId(searchResult: unknown, title: string): string | null {
  try {
    const result = searchResult as { ok?: boolean; data?: Array<{ id: string; title: string }> };
    if (!result?.ok || !Array.isArray(result.data) || result.data.length === 0) {
      return null;
    }
    // Exact title match (case-insensitive) — avoid false positives from fuzzy search
    const match = result.data.find(
      (e) => e.title.toLowerCase().trim() === title.toLowerCase().trim(),
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

export const MemorySyncPlugin: Plugin = async (input, options?: PluginOptions) => {
  const opts: Required<MemorySyncOptions> = {
    ...DEFAULTS,
    ...(options as MemorySyncOptions | undefined),
  };

  if (!opts.enabled) {
    return {};
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const performSync = async (): Promise<void> => {
    try {
      if (!existsSync(opts.factsPath)) {
        return;
      }

      const factsContent = readFileSync(opts.factsPath, "utf-8");
      const entries = parseFactsFile(factsContent);
      const state = loadState(opts.statePath);

      const toSync: FactsEntry[] = [];
      for (const entry of entries) {
        if (!state[entry.hash]) {
          toSync.push(entry);
        }
      }

      if (toSync.length === 0) {
        return;
      }

      // OC-003: Dedup — search by title before create.
      // If an entry with the same title exists, use knowledge_bulk_update instead.
      const toCreate: FactsEntry[] = [];
      const toUpdate: Array<{ entry: FactsEntry; id: string }> = [];

      for (const entry of toSync) {
        try {
          const searchResult = await input.client.mcp.call({
            server: "mcp-task-knowledge",
            tool: "search_knowledge",
            args: {
              project: opts.project,
              query: entry.title,
              limit: 1,
            },
          });

          const existingId = extractExistingId(searchResult, entry.title);
          if (existingId) {
            toUpdate.push({ entry, id: existingId });
          } else {
            toCreate.push(entry);
          }
        } catch {
          // search failed — default to create (safe fallback)
          toCreate.push(entry);
        }
      }

      // Create new entries
      if (toCreate.length > 0) {
        const items = toCreate.map((e) => ({
          title: e.title,
          content: e.content,
          type: "note",
          tags: e.tags.length > 0 ? e.tags : ["fact"],
        }));

        await input.client.mcp.call({
          server: "mcp-task-knowledge",
          tool: "knowledge_bulk_create",
          args: {
            project: opts.project,
            items,
          },
        });
      }

      // Update existing entries (dedup — avoid duplicates)
      for (const { entry, id } of toUpdate) {
        try {
          await input.client.mcp.call({
            server: "mcp-task-knowledge",
            tool: "knowledge_bulk_update",
            args: {
              project: opts.project,
              items: [{
                id,
                title: entry.title,
                content: entry.content,
                tags: entry.tags.length > 0 ? entry.tags : ["fact"],
              }],
            },
          });
        } catch {
          // update failed — entry will be retried next sync
        }
      }

      // Update state for both created and updated
      const now = new Date().toISOString();
      for (const entry of toSync) {
        state[entry.hash] = {
          title: entry.title,
          syncedAt: now,
        };
      }
      saveState(opts.statePath, state);
    } catch {
      // best-effort — don't block agent work on sync failures
    }
  };

  const debouncedSync = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void performSync();
    }, opts.debounceMs);
  };

  return {
    "tool.execute.after": async (toolInput) => {
      // Trigger sync after /remember command or write tool touching facts.md
      const isRemember =
        toolInput.tool === "remember" ||
        toolInput.tool === "/remember" ||
        (toolInput.tool === "command" && toolInput.callID?.includes("remember"));

      const touchesFacts =
        toolInput.args?.path &&
        typeof toolInput.args.path === "string" &&
        toolInput.args.path.includes("facts.md");

      if (isRemember || touchesFacts) {
        debouncedSync();
      }
    },
  };
};

export default MemorySyncPlugin;
