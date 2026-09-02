/**
 * memory-profile.ts — OpenCode плагин: auto-maintained user profile (NEXT-022).
 *
 * При каждом /remember → extract user-specific facts → profile_get/update →
 * always-on context injection. Расширение memory-sync.ts.
 *
 * Архитектура:
 *   - Hook `tool.execute.after` на /remember → debounce → profile update
 *   - Hook `experimental.chat.system.transform` → inject profile context block
 *   - Profile хранится через MCP memory_profile_update / memory_profile_context
 *
 * Установка:
 *   cp extensions/opencode/memory-profile.ts ~/.config/opencode/plugins/
 */

/// <reference types="node" />
import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { basename, join } from "node:path";
import { homedir } from "node:os";

interface MemoryProfileOptions {
  userId?: string;
  project?: string;
  maxTokens?: number;
  enabled?: boolean;
  debounceMs?: number;
}

const DEFAULTS: Required<MemoryProfileOptions> = {
  userId: "default-user",
  project: "agent-memory",
  maxTokens: 500,
  enabled: true,
  debounceMs: 5000,
};

const MCP_KNOWLEDGE_URL =
  process.env.MCP_KNOWLEDGE_URL ?? "http://127.0.0.1:3001/mcp";

async function mcpCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: { name: tool, arguments: args },
  });

  const resp = await fetch(MCP_KNOWLEDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body,
  });

  if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`);

  const contentType = resp.headers.get("content-type") ?? "";
  let json: unknown;

  if (contentType.includes("text/event-stream")) {
    const text = await resp.text();
    const dataLines = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6).trim());
    json = JSON.parse(dataLines.join("\n"));
  } else {
    json = await resp.json();
  }

  const rpcResp = json as { result?: { content?: Array<{ type: string; text: string }> }; error?: { message: string } };
  if (rpcResp.error) throw new Error(`MCP error: ${rpcResp.error.message}`);
  if (rpcResp.result?.content?.[0]?.text) {
    try { return JSON.parse(rpcResp.result.content[0].text); } catch { return rpcResp.result.content[0].text; }
  }
  return rpcResp.result;
}

export const MemoryProfilePlugin: Plugin = async (input, options?: PluginOptions) => {
  const opts: Required<MemoryProfileOptions> = {
    ...DEFAULTS,
    ...(options as MemoryProfileOptions | undefined),
  };

  if (!opts.enabled) return {};

  const projectDir = input.directory || process.cwd();
  const projectName = opts.project ?? basename(projectDir);
  const MARKER = "<memory-profile-context>";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let cachedProfileBlock: string | null = null;
  let lastProfileFetch = 0;
  const PROFILE_CACHE_MS = 60000;

  const fetchProfileBlock = async (): Promise<string> => {
    try {
      const result = (await mcpCall("memory_profile_context", {
        userId: opts.userId,
        maxTokens: opts.maxTokens,
      })) as { ok?: boolean; data?: { context?: string } };

      if (result?.ok && result.data?.context) {
        return result.data.context;
      }
    } catch {
      // MCP unavailable — no profile
    }
    return "";
  };

  const debouncedProfileUpdate = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      cachedProfileBlock = null;
      lastProfileFetch = 0;
    }, opts.debounceMs);
  };

  return {
    "tool.execute.after": async (toolInput) => {
      const isRemember =
        toolInput.tool === "remember" ||
        toolInput.tool === "/remember" ||
        (toolInput.tool === "command" && toolInput.callID?.includes("remember"));

      if (isRemember) {
        debouncedProfileUpdate();
      }
    },

    "experimental.chat.system.transform": async (_sysInput, sysOutput) => {
      if (!Array.isArray(sysOutput.system)) return;

      const alreadyInjected = sysOutput.system.some(
        (s: string) => typeof s === "string" && s.includes(MARKER),
      );
      if (alreadyInjected) return;

      const now = Date.now();
      if (!cachedProfileBlock || now - lastProfileFetch > PROFILE_CACHE_MS) {
        cachedProfileBlock = await fetchProfileBlock();
        lastProfileFetch = now;
      }

      if (cachedProfileBlock) {
        sysOutput.system.push(`<memory-profile-context>
${cachedProfileBlock}
</memory-profile-context>`);
      }
    },
  };
};

export default MemoryProfilePlugin;
