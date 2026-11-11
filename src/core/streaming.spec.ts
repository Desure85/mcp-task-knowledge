/**
 * core/streaming.spec.ts — Tests for streaming progress (AI-013, SPEC-07)
 */

import { describe, it, expect, vi } from 'vitest';
import { createProgressSender, progressTokenFromExtra, withProgress } from './streaming.js';
import type { ServerContext } from '../register/context.js';

function mockCtx(sendNotification?: (method: string, params: unknown) => Promise<void>): ServerContext {
  return {
    server: { sendNotification } as unknown as ServerContext['server'],
  } as ServerContext;
}

describe('AI-013: streaming progress', () => {
  it('does not send without a client progressToken', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const progress = createProgressSender(mockCtx(sendNotification));
    await progress({ current: 1, total: 3, message: 'Step 1' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends notifications/progress with the client progressToken', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const progress = createProgressSender(mockCtx(sendNotification), 'tok-1');
    await progress({ current: 1, total: 3, message: 'Step 1' });
    expect(sendNotification).toHaveBeenCalledWith('notifications/progress', {
      progressToken: 'tok-1', progress: 1, total: 3, message: 'Step 1',
    });
  });

  it('does not throw when sendNotification is missing', async () => {
    const progress = createProgressSender(mockCtx(undefined), 7);
    await expect(progress({ current: 0, total: 0 })).resolves.toBeUndefined();
  });

  it('swallows transport errors', async () => {
    const sendNotification = vi.fn().mockRejectedValue(new Error('transport down'));
    const progress = createProgressSender(mockCtx(sendNotification), 7);
    await expect(progress({ current: 1, total: 1 })).resolves.toBeUndefined();
  });

  it('extracts only string/number tokens from _meta', () => {
    expect(progressTokenFromExtra({ _meta: { progressToken: 'a' } })).toBe('a');
    expect(progressTokenFromExtra({ _meta: { progressToken: 9 } })).toBe(9);
    expect(progressTokenFromExtra({ _meta: {} })).toBeUndefined();
    expect(progressTokenFromExtra({ _meta: { progressToken: { bad: true } } })).toBeUndefined();
    expect(progressTokenFromExtra(undefined)).toBeUndefined();
  });

  it('withProgress calls fn for each item with progress updates', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const progress = createProgressSender(mockCtx(sendNotification), 'tok');
    const fn = vi.fn().mockResolvedValue(undefined);
    const items = ['a', 'b', 'c'];
    await withProgress(items, progress, fn, 'Processing');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    const lastCall = sendNotification.mock.calls[2];
    expect(lastCall[1]).toMatchObject({ progressToken: 'tok', progress: 3, total: 3 });
  });

  it('withProgress handles empty array', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const progress = createProgressSender(mockCtx(sendNotification), 'tok');
    const fn = vi.fn();
    await withProgress([], progress, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
