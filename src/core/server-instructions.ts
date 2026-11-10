/**
 * CM-03: server-level `instructions` for MCP `initialize`.
 *
 * MCP clients expose `instructions` from `initialize` to the model. The text is generated from the
 * live tool registry — domain names and counts are derived from registered tool names, never
 * hardcoded — and stays short (≤ 15 lines). Full guidance and profiles belong to AA-08; this module
 * only provides the verifiable minimum: where to look, how to inspect a tool, how to call it.
 */

export const MAX_SERVER_INSTRUCTION_LINES = 15;

export interface InstructionTool {
  name: string;
}

/** Group tool names by their leading namespace (`tasks_list` → `tasks`, `mcp.authenticate` → `mcp`). */
export function toolDomains(tools: InstructionTool[]): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const separator = tool.name.includes('_') ? tool.name.indexOf('_') : tool.name.indexOf('.');
    const domain = separator > 0 ? tool.name.slice(0, separator) : 'other';
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

/** Build the `initialize.instructions` text from the live registry. */
export function buildServerInstructions(tools: InstructionTool[]): string {
  const domains = toolDomains(tools);
  const domainText = domains.map(({ domain, count }) => `${domain} ${count}`).join(', ') || 'none';
  const lines = [
    `mcp-task-knowledge: ${tools.length} tools across ${domains.length} domains.`,
    'Workflow: tools_list {search:"..."} to find a name; tool_schema {name} for its input; tools_run {name, params} to call it.',
    'Batch independent calls with tools_batch {items:[{name,params}]} (parallel, no stop flag); tools_run is sequential and supports stopOnError.',
    `Domains: ${domainText}.`,
    'Prefer a domain tool when you already know its name; tools_run is for nested or discovered calls.',
    'Search before guessing a tool name; do not invent tools, read the schema first.',
  ];
  if (lines.length > MAX_SERVER_INSTRUCTION_LINES) {
    return lines.slice(0, MAX_SERVER_INSTRUCTION_LINES).join('\n');
  }
  return lines.join('\n');
}

interface InstructionTarget {
  server?: { _instructions?: string };
  _instructions?: string;
}

/**
 * The MCP SDK exposes `instructions` only in the server constructor and has no public setter; tools
 * are registered after construction, so the generated text is attached to the low-level server that
 * `initialize` reads. Both `McpServer` (wraps `server`) and the low-level `Server` (used by the
 * bridge) are supported.
 */
export function setServerInstructions(target: unknown, instructions: string): void {
  const holder = target as InstructionTarget;
  const lowLevel = holder.server ?? holder;
  lowLevel._instructions = instructions;
}
