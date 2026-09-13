import { describe, it, expect, vi } from 'vitest';
import { elicitConfirm } from './elicitation.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function fakeCtx(opts: {
  caps?: { elicitation?: object } | undefined;
  elicitImpl?: () => Promise<{ action: string; content?: Record<string, unknown> }>;
  capsThrow?: boolean;
}) {
  const elicitInput = vi.fn(opts.elicitImpl ?? (async () => ({ action: 'accept', content: { confirm: true } })));
  const getClientCapabilities = vi.fn(() => {
    if (opts.capsThrow) throw new Error('no client');
    return opts.caps;
  });
  const server = { server: { getClientCapabilities, elicitInput } };
  return { ctx: { server: server as unknown as McpServer }, elicitInput };
}

describe('TR-12: elicitConfirm', () => {
  it('returns unsupported when client has no elicitation capability', async () => {
    const { ctx, elicitInput } = fakeCtx({ caps: {} });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('unsupported');
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it('returns unsupported when getClientCapabilities returns undefined', async () => {
    const { ctx } = fakeCtx({ caps: undefined });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('unsupported');
  });

  it('returns accepted when user accepts with confirm=true', async () => {
    const { ctx, elicitInput } = fakeCtx({
      caps: { elicitation: {} },
      elicitImpl: async () => ({ action: 'accept', content: { confirm: true } }),
    });
    expect(await elicitConfirm(ctx, 'delete 3 tasks?')).toBe('accepted');
    expect(elicitInput).toHaveBeenCalledOnce();
    const params = (elicitInput.mock.calls[0] as any[])[0];
    expect(params.message).toBe('delete 3 tasks?');
    expect(params.requestedSchema.required).toContain('confirm');
  });

  it('returns declined when user accepts but confirm is not true', async () => {
    const { ctx } = fakeCtx({
      caps: { elicitation: {} },
      elicitImpl: async () => ({ action: 'accept', content: { confirm: false } }),
    });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('declined');
  });

  it('returns declined when user accepts with no content', async () => {
    const { ctx } = fakeCtx({
      caps: { elicitation: {} },
      elicitImpl: async () => ({ action: 'accept' }),
    });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('declined');
  });

  it.each(['decline', 'cancel'])('returns declined on action=%s', async (action) => {
    const { ctx } = fakeCtx({
      caps: { elicitation: {} },
      elicitImpl: async () => ({ action }),
    });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('declined');
  });

  it('returns error when elicitInput throws (fail-safe)', async () => {
    const { ctx } = fakeCtx({
      caps: { elicitation: {} },
      elicitImpl: async () => { throw new Error('Client does not support elicitation'); },
    });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('error');
  });

  it('returns error when getClientCapabilities throws', async () => {
    const { ctx } = fakeCtx({ capsThrow: true });
    expect(await elicitConfirm(ctx, 'delete?')).toBe('error');
  });
});
