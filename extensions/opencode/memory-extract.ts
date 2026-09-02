/**
 * memory-extract.ts — OpenCode плагин: auto conversation→fact extraction (NEXT-020).
 *
 * Hook на end of session → LLM extract facts from transcript → facts.md → MCP sync.
 * Заменяет ручной draft на auto-extraction.
 *
 * Архитектура:
 *   - Hook `experimental.chat.system.transform` — инжектирует инструкцию
 *   - Агент сам вызывает memory_extract MCP tool в конце сессии
 *   - Плагин НЕ вызывает MCP сам — он инструктирует агента
 *
 * Установка:
 *   cp extensions/opencode/memory-extract.ts ~/.config/opencode/plugins/
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { basename, join } from "node:path";
import { homedir } from "node:os";

interface MemoryExtractOptions {
  project?: string;
  enabled?: boolean;
  autoExtract?: boolean;
}

const DEFAULTS: Required<MemoryExtractOptions> = {
  project: "agent-memory",
  enabled: true,
  autoExtract: true,
};

const buildExtractInstructions = (
  project: string,
  globalProject: string,
  projectFactsPath: string,
  globalFactsPath: string,
): string => {
  return `<memory-extract-instructions>
## Авто-экстракция памяти (NEXT-020)

В конце сессии (перед /end-session) — вызови \`memory_extract\` (MCP):
- transcript: ключевые моменты сессии (факты, решения, находки)
- project: \`${project}\` для проектных знаний, \`${globalProject}\` для глобальных
- persist: true (сохранить в knowledge base)
- maxFacts: 20
- minConfidence: 0.5

Это ДОПОЛНЕНИЕ к ручному draft-*.md. Draft = саморефлексия (процесс),
memory_extract = структурированные факты (результат).

### Когда вызывать

- Перед /end-session — извлечь факты из всей сессии
- После важного решения — извлечь decision fact
- После исправления бага — извлечь error+fix facts
- НЕ вызывай на каждое сообщение — только в конце или при значимом событии

### Что извлекать

- decisions: "We decided to use X"
- preferences: "User prefers Y over Z"
- conventions: "Always use strict mode"
- errors: "Error in module X"
- fixes: "Fixed by doing Y"
- facts: "Project uses PostgreSQL"
- skills: "Learned how to do Z"

### Проектные vs глобальные

- Проектные факты (project: \`${project}\`): специфичны для текущего проекта
- Глобальные факты (project: \`${globalProject}\`): применимы к любому проекту
- По умолчанию — проектные. Глобальные — только если факт универсален

### Связь с draft-*.md

Draft = саморефлексия (что я не знал, что поправил пользователь, аномалии).
memory_extract = структурированные факты (что было сделано, какие решения).
Оба потока идут параллельно — draft в draft-*.md, facts в knowledge base.

Пути:
- Проектные факты: ${projectFactsPath}
- Глобальные факты: ${globalFactsPath}
</memory-extract-instructions>`;
};

export const MemoryExtractPlugin: Plugin = async (input, options?: PluginOptions) => {
  const userOpts = options as MemoryExtractOptions | undefined;
  const projectDir = input.directory || process.cwd();
  const projectName = userOpts?.project ?? basename(projectDir);
  const globalProjectName = "agent-memory";

  if (userOpts?.enabled === false) {
    return {};
  }

  const projectMemoryDir = join(projectDir, ".omo", "memory");
  const globalMemoryDir = join(homedir(), ".omo", "memory");
  const projectFactsPath = join(projectMemoryDir, "facts.md");
  const globalFactsPath = join(globalMemoryDir, "facts.md");

  const MARKER = "<memory-extract-instructions>";

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!Array.isArray(output.system)) return;

      const alreadyInjected = output.system.some(
        (s: string) => typeof s === "string" && s.includes(MARKER),
      );
      if (alreadyInjected) return;

      output.system.push(
        buildExtractInstructions(projectName, globalProjectName, projectFactsPath, globalFactsPath),
      );
    },
  };
};

export default MemoryExtractPlugin;
