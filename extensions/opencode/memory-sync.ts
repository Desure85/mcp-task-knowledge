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
 * Многопроектность (dual sync):
 *   - Проектные facts.md/patterns.json → MCP project = basename(input.directory)
 *   - Глобальные facts.md/patterns.json → MCP project = "agent-memory"
 *   - Каждый таргет имеет свой .sync-state.json, debounce общий.
 *
 * Конфигурация (через opencode.json plugin options):
 *   - project: MCP project name (default: basename(input.directory))
 *   - factsPath: путь к facts.md (default: "<project>/.omo/memory/facts.md")
 *   - patternsPath: путь к patterns.json (default: "<project>/.omo/memory/patterns.json")
 *   - statePath: путь к state-файлу (default: "<project>/.omo/memory/.sync-state.json")
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
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

interface MemorySyncOptions {
  project?: string;
  factsPath?: string;
  patternsPath?: string;
  statePath?: string;
  debounceMs?: number;
  enabled?: boolean;
}

const DEFAULTS: Required<MemorySyncOptions> = {
  project: "agent-memory",
  factsPath: join(homedir(), ".omo", "memory", "facts.md"),
  patternsPath: join(homedir(), ".omo", "memory", "patterns.json"),
  statePath: join(homedir(), ".omo", "memory", ".sync-state.json"),
  debounceMs: 30000,
  enabled: true,
};

/** Глобальная memory-директория (кросс-проектные знания). */
const GLOBAL_MEMORY_DIR = join(homedir(), ".omo", "memory");

/**
 * Пути проектной memory-директории: <project>/.omo/memory/.
 * Используется, когда проект передан через input.directory (PluginInput).
 */
function buildProjectPaths(projectDir: string): {
  factsPath: string;
  patternsPath: string;
  statePath: string;
} {
  const memoryDir = join(projectDir, ".omo", "memory");
  return {
    factsPath: join(memoryDir, "facts.md"),
    patternsPath: join(memoryDir, "patterns.json"),
    statePath: join(memoryDir, ".sync-state.json"),
  };
}

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
  if (content.includes("[global]")) tags.add("global");
  return Array.from(tags);
}

/**
 * Parse patterns.json into structured entries (OC-004).
 * Each pattern → FactsEntry with [pattern, importance-N] tags.
 */
function parsePatternsFile(content: string): FactsEntry[] {
  try {
    const patterns = JSON.parse(content);
    if (!Array.isArray(patterns)) return [];

    return patterns.map((p: { name?: string; description?: string; matches?: unknown[]; importance?: number }) => {
      const title = `[pattern] ${p.name ?? "unnamed"}`;
      const matchCount = Array.isArray(p.matches) ? p.matches.length : 0;
      const bodyText = [
        p.description ?? "",
        "",
        `Matches: ${matchCount}`,
      ].join("\n").trim();
      const hash = createHash("sha256")
        .update(title + bodyText)
        .digest("hex")
        .substring(0, 16);
      const tags = ["pattern"];
      if (typeof p.importance === "number") {
        tags.push(`importance-${p.importance}`);
      }
      return { title, content: bodyText, hash, tags };
    });
  } catch {
    return [];
  }
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
  const projectDir = input.directory || process.cwd();
  const projectPaths = buildProjectPaths(projectDir);
  const userOpts = options as MemorySyncOptions | undefined;
  const projectName = userOpts?.project ?? basename(projectDir);
  const globalProjectName = "agent-memory";
  const debounceMs = userOpts?.debounceMs ?? DEFAULTS.debounceMs;

  if (userOpts?.enabled === false) {
    return {};
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  interface SyncTarget {
    factsPath: string;
    patternsPath: string;
    statePath: string;
    mcpProject: string;
  }

  const targets: SyncTarget[] = [
    {
      factsPath: userOpts?.factsPath ?? projectPaths.factsPath,
      patternsPath: userOpts?.patternsPath ?? projectPaths.patternsPath,
      statePath: userOpts?.statePath ?? projectPaths.statePath,
      mcpProject: projectName,
    },
    {
      factsPath: join(GLOBAL_MEMORY_DIR, "facts.md"),
      patternsPath: join(GLOBAL_MEMORY_DIR, "patterns.json"),
      statePath: join(GLOBAL_MEMORY_DIR, ".sync-state.json"),
      mcpProject: globalProjectName,
    },
  ];

  const performSyncForTarget = async (target: SyncTarget): Promise<void> => {
    try {
      if (!existsSync(target.factsPath)) {
        return;
      }

      const factsContent = readFileSync(target.factsPath, "utf-8");
      const entries = parseFactsFile(factsContent);

      let allEntries = entries;
      if (existsSync(target.patternsPath)) {
        try {
          const patternsContent = readFileSync(target.patternsPath, "utf-8");
          const patternEntries = parsePatternsFile(patternsContent);
          allEntries = [...entries, ...patternEntries];
        } catch {
          // patterns.json parse failed — continue with facts only
        }
      }

      const state = loadState(target.statePath);

      const toSync: FactsEntry[] = [];
      for (const entry of allEntries) {
        if (!state[entry.hash]) {
          toSync.push(entry);
        }
      }

      if (toSync.length === 0) {
        return;
      }

      const toCreate: FactsEntry[] = [];
      const toUpdate: Array<{ entry: FactsEntry; id: string }> = [];

      for (const entry of toSync) {
        try {
          const searchResult = await input.client.mcp.call({
            server: "mcp-task-knowledge",
            tool: "search_knowledge",
            args: {
              project: target.mcpProject,
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
          toCreate.push(entry);
        }
      }

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
            project: target.mcpProject,
            items,
          },
        });
      }

      for (const { entry, id } of toUpdate) {
        try {
          await input.client.mcp.call({
            server: "mcp-task-knowledge",
            tool: "knowledge_bulk_update",
            args: {
              project: target.mcpProject,
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

      const now = new Date().toISOString();
      for (const entry of toSync) {
        state[entry.hash] = {
          title: entry.title,
          syncedAt: now,
        };
      }
      saveState(target.statePath, state);
    } catch {
      // best-effort — don't block agent work on sync failures
    }
  };

  const performSync = async (): Promise<void> => {
    for (const target of targets) {
      await performSyncForTarget(target);
    }
  };

  const debouncedSync = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void performSync();
    }, debounceMs);
  };

  return {
    "tool.execute.after": async (toolInput) => {
      // Trigger sync after /remember command or write tool touching facts.md
      const isRemember =
        toolInput.tool === "remember" ||
        toolInput.tool === "/remember" ||
        (toolInput.tool === "command" && toolInput.callID?.includes("remember"));

      const touchesMemory =
        toolInput.args?.path &&
        typeof toolInput.args.path === "string" &&
        (toolInput.args.path.includes("facts.md") ||
          toolInput.args.path.includes("patterns.json"));

      if (isRemember || touchesMemory) {
        debouncedSync();
      }
    },
  };
};

export default MemorySyncPlugin;
