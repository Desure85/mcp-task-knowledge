import { describe, it, expect } from 'vitest';
import {
  createRealtimeState,
  reduceRealtimeState,
  statusForPhase,
  realtimeRetrySeconds,
  realtimeLabel,
  realtimePhaseLabel,
  realtimeExplanation,
  realtimeCanRetry,
  realtimeAriaLabel,
  realtimeAnnouncementKey,
} from './realtime-state';

const t0 = 1_700_000_000_000;

describe('realtime state machine', () => {
  it('starts in Connecting with attempt 1', () => {
    const state = createRealtimeState();
    expect(state).toMatchObject({ phase: 'connecting', attempt: 1, retryAt: null, configured: true });
    expect(realtimePhaseLabel(state.phase)).toBe('Connecting');
    expect(realtimeLabel(state)).toContain('attempt 1');
  });

  it('goes Live on open and resets the attempt', () => {
    const state = reduceRealtimeState(
      reduceRealtimeState(createRealtimeState(), { type: 'attempt', attempt: 2 }),
      { type: 'open' },
    );
    expect(state.phase).toBe('live');
    expect(state.attempt).toBe(0);
    expect(statusForPhase(state.phase)).toBe('connected');
    expect(realtimeLabel(state, 2)).toBe('Live (2 online)');
    expect(realtimeAriaLabel(state, 0, t0)).toContain('Realtime connection: Live');
  });

  it('reports Offline immediately for a configured initial failure', () => {
    const state = reduceRealtimeState(createRealtimeState(), {
      type: 'failure', reason: 'connect-failed', attempt: 1, retryAt: t0 + 1000,
    });
    expect(state.phase).toBe('offline');
    expect(realtimeCanRetry(state)).toBe(true);
    expect(realtimeExplanation(state, t0).action).toMatch(/Page data still works/);
    expect(realtimeLabel(state, 0, t0)).toBe('Offline');
  });

  it('reports Reconnecting with countdown after a live connection is lost', () => {
    const live = reduceRealtimeState(createRealtimeState(), { type: 'open' });
    const state = reduceRealtimeState(live, {
      type: 'failure', reason: 'connection-lost', attempt: 3, retryAt: t0 + 8000,
    });
    expect(state.phase).toBe('reconnecting');
    expect(realtimeRetrySeconds(state, t0)).toBe(8);
    expect(realtimeLabel(state, 0, t0)).toBe('Reconnecting in 8s (attempt 3)');
    expect(realtimeExplanation(state, t0).reason).toContain('Retrying in 8s');
  });

  it('keeps ticket-network reconnecting when configured, disabled when not configured', () => {
    const configured = reduceRealtimeState(createRealtimeState(), {
      type: 'failure', reason: 'ticket-network', attempt: 2, retryAt: t0 + 2000,
    });
    expect(configured.phase).toBe('reconnecting');

    const unconfigured = createRealtimeState({ configured: false });
    const disabled = reduceRealtimeState(unconfigured, {
      type: 'failure', reason: 'ticket-network', attempt: 2, retryAt: t0 + 2000,
    });
    expect(disabled.phase).toBe('disabled');
    expect(disabled.retryAt).toBeNull();
    expect(realtimeExplanation(disabled, t0).action).toContain('NEXT_PUBLIC_MCP_WS_URL');
  });

  it('ticket 401 is Offline with an auth-expired sign-in action and no retry', () => {
    const state = reduceRealtimeState(createRealtimeState(), { type: 'ticket-auth' });
    expect(state.phase).toBe('offline');
    expect(state.authExpired).toBe(true);
    expect(realtimeCanRetry(state)).toBe(false);
    expect(realtimeExplanation(state, t0).action).toContain('Sign in again');
  });

  it('supports retry and not-configured transitions', () => {
    const retry = reduceRealtimeState(createRealtimeState(), { type: 'retry' });
    expect(retry.phase).toBe('connecting');
    expect(retry.reason).toBe('retry');

    const disabled = reduceRealtimeState(createRealtimeState(), { type: 'not-configured' });
    expect(disabled.phase).toBe('disabled');
    expect(disabled.retryAt).toBeNull();
  });

  it('does not spam announcements for countdown ticks', () => {
    const state = {
      ...createRealtimeState({ configured: true }),
      phase: 'reconnecting' as const,
      attempt: 3,
      reason: 'connection-lost' as const,
      retryAt: t0 + 8000,
    };
    expect(realtimeAnnouncementKey(state)).toBe(realtimeAnnouncementKey({ ...state, retryAt: t0 + 1000 }));
    expect(realtimeAnnouncementKey(state)).not.toBe(realtimeAnnouncementKey({ ...state, attempt: 4 }));
  });

  it('explains every phase without a false fallback promise', () => {
    for (const phase of ['live', 'connecting', 'reconnecting', 'offline', 'disabled'] as const) {
      const base = createRealtimeState();
      const state = { ...base, phase, reason: phase === 'disabled' ? 'not-configured' as const : base.reason, retryAt: phase === 'reconnecting' ? t0 + 1000 : null };
      const explanation = realtimeExplanation(state, t0);
      expect(explanation.title).toBeTruthy();
      expect(explanation.reason).toBeTruthy();
      expect(explanation.action).toBeTruthy();
    }
  });
});
