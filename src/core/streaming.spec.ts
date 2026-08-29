/**
 * core/streaming.spec.ts — Tests for streaming progress (AI-013)
 */

import { describe, it, expect, vi } from 'vitest';
import { createProgressSender, withProgress } from './streaming.js';
import type { ServerContext } from '../register/context.js';

function mockCtx(sendNotification?: (method: string, params: unknown) => Promise<void>): ServerContext {
  return {
    server: { sendNotification } as unknown as ServerContext['server'],
  } as ServerContext;
}

describe('AI-013: streaming progress', () => {
  it('createProgressSender sends notifications/progress', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx(sendNotification);
    const progress = createProgressSender(ctx);
    await progress({ current: 1, total: 3, message: 'Step 1' });
    expect(sendNotification).toHaveBeenCalledWith('notifications/progress', {
      progress: 1, total: 3, message: 'Step 1',
    });
  });

  it('createProgressSender does not throw when sendNotification is missing', async () => {
    const ctx = mockCtx(undefined);
    const progress = createProgressSender(ctx);
    await expect(progress({ current: 0, total: 0 })).resolves.toBeUndefined();
  });

  it('createProgressSender swallows transport errors', async () => {
    const sendNotification = vi.fn().mockRejectedValue(new Error('transport down'));
    const ctx = mockCtx(sendNotification);
    const progress = createProgressSender(ctx);
    await expect(progress({ current: 1, total: 1 })).resolves.toBeUndefined();
  });

  it('withProgress calls fn for each item with progress updates', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx(sendNotification);
    const progress = createProgressSender(ctx);
    const fn = vi.fn().mockResolvedValue(undefined);
    const items = ['a', 'b', 'c'];
    await withProgress(items, progress, fn, 'Processing');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    // Last call should have current=3, total=3
    const lastCall = sendNotification.mock.calls[2];
    expect(lastCall[1]).toMatchObject({ progress: 3, total: 3 });
  });

  it('withProgress handles empty array', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx(sendNotification);
    const progress = createProgressSender(ctx);
    const fn = vi.fn();
    await withProgress([], progress, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
