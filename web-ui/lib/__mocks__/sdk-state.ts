/**
 * Shared mock state for @modelcontextprotocol/sdk test doubles.
 * Imported by both the __mocks__ implementations and the test file —
 * plain module state, no vitest dependency, so no hoisting/TDZ issues.
 */

export interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export const mockSdkState = {
  connectCount: 0,
  connectShouldFail: false,
  calls: [] as ToolCall[],
  /** Per-test implementation for Client.callTool. */
  impl: null as null | ((call: ToolCall) => unknown),
  reset() {
    this.connectCount = 0;
    this.connectShouldFail = false;
    this.calls.length = 0;
    this.impl = null;
  },
};
