import type { ConnectionStatus } from './realtime';

export type RealtimePhase = 'live' | 'connecting' | 'reconnecting' | 'offline' | 'disabled';

export type RealtimeReason =
  | 'init'
  | 'open'
  | 'connection-lost'
  | 'connect-failed'
  | 'timeout'
  | 'ticket-auth'
  | 'ticket-network'
  | 'socket-error'
  | 'retry'
  | 'not-configured';

export interface RealtimeUiState {
  phase: RealtimePhase;
  attempt: number;
  retryAt: number | null;
  reason: RealtimeReason;
  configured: boolean;
  authExpired?: boolean;
}

export type RealtimeStateEvent =
  | { type: 'attempt'; attempt: number }
  | { type: 'open' }
  | { type: 'failure'; reason: Exclude<RealtimeReason, 'init' | 'open' | 'ticket-auth' | 'retry' | 'not-configured'>; attempt: number; retryAt: number | null }
  | { type: 'ticket-auth' }
  | { type: 'retry'; attempt?: number }
  | { type: 'not-configured' };

export function createRealtimeState(opts: { configured?: boolean; attempt?: number } = {}): RealtimeUiState {
  return {
    phase: 'connecting',
    attempt: opts.attempt ?? 1,
    retryAt: null,
    reason: 'init',
    configured: opts.configured ?? true,
  };
}

export function reduceRealtimeState(
  state: RealtimeUiState,
  event: RealtimeStateEvent,
): RealtimeUiState {
  switch (event.type) {
    case 'attempt':
      return { ...state, phase: 'connecting', attempt: Math.max(1, event.attempt), retryAt: null, reason: 'retry' };
    case 'open':
      return { ...state, phase: 'live', attempt: 0, retryAt: null, reason: 'open', authExpired: false };
    case 'failure': {
      const wasLive = state.phase === 'live';
      const phase: RealtimePhase =
        event.reason === 'connection-lost'
          || wasLive
          || (event.reason === 'ticket-network' && state.configured)
          ? 'reconnecting'
          : !state.configured
            ? 'disabled'
            : 'offline';
      return {
        ...state,
        phase,
        attempt: Math.max(1, event.attempt),
        retryAt: phase === 'disabled' ? null : event.retryAt,
        reason: event.reason,
        authExpired: false,
      };
    }
    case 'ticket-auth':
      return { ...state, phase: 'offline', attempt: Math.max(1, state.attempt), retryAt: null, reason: 'ticket-auth', authExpired: true };
    case 'retry':
      return { ...state, phase: 'connecting', attempt: Math.max(1, event.attempt ?? 1), retryAt: null, reason: 'retry', authExpired: false };
    case 'not-configured':
      return { ...state, phase: 'disabled', retryAt: null, reason: 'not-configured' };
  }
}

export function statusForPhase(phase: RealtimePhase): ConnectionStatus {
  switch (phase) {
    case 'live':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'offline':
    case 'disabled':
      return 'unavailable';
  }
}

export function realtimeRetrySeconds(state: RealtimeUiState, now = Date.now()): number {
  if (state.retryAt === null) return 0;
  return Math.max(0, Math.ceil((state.retryAt - now) / 1000));
}

export function realtimePhaseLabel(phase: RealtimePhase): string {
  switch (phase) {
    case 'live':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'offline':
      return 'Offline';
    case 'disabled':
      return 'Realtime off';
  }
}

export function realtimeLabel(state: RealtimeUiState, presence = 0, now = Date.now()): string {
  switch (state.phase) {
    case 'live':
      return presence > 0 ? `Live (${presence} online)` : 'Live';
    case 'connecting':
      return `Connecting… (attempt ${Math.max(1, state.attempt)})`;
    case 'reconnecting': {
      const seconds = realtimeRetrySeconds(state, now);
      return seconds > 0
        ? `Reconnecting in ${seconds}s (attempt ${Math.max(1, state.attempt)})`
        : `Reconnecting… (attempt ${Math.max(1, state.attempt)})`;
    }
    case 'offline':
      return 'Offline';
    case 'disabled':
      return 'Realtime off';
  }
}

export interface RealtimeExplanation {
  title: string;
  reason: string;
  action: string;
}

export function realtimeExplanation(state: RealtimeUiState, now = Date.now()): RealtimeExplanation {
  const attempt = Math.max(1, state.attempt);
  switch (state.phase) {
    case 'live':
      return {
        title: 'Realtime: Live',
        reason: 'The authenticated WebSocket is open.',
        action: 'Page data is available and live updates are flowing.',
      };
    case 'connecting':
      return {
        title: 'Realtime: Connecting',
        reason: `Opening an authenticated WebSocket (attempt ${attempt}).`,
        action: 'Page data is available while the connection is established.',
      };
    case 'reconnecting': {
      const seconds = realtimeRetrySeconds(state, now);
      return {
        title: 'Realtime: Reconnecting',
        reason: seconds > 0
          ? `The connection was lost. Retrying in ${seconds}s (attempt ${attempt}).`
          : `The connection was lost. Retrying now (attempt ${attempt}).`,
        action: 'Page data remains available; reconnection is automatic.',
      };
    }
    case 'offline':
      return {
        title: 'Realtime: Offline',
        reason: state.authExpired
          ? 'Your session expired while opening the realtime connection.'
          : 'The realtime server could not be reached.',
        action: state.authExpired
          ? 'Sign in again to restore realtime; page data remains available.'
          : 'Check the WebSocket address and network, then retry. Page data still works without realtime.',
      };
    case 'disabled':
      return {
        title: 'Realtime: Off',
        reason: 'WebSocket is not configured and the same-origin /ws endpoint is unavailable.',
        action: 'Set NEXT_PUBLIC_MCP_WS_URL to the realtime endpoint (for example ws://localhost:3001/ws), or serve the UI from the MCP origin. Page data still works without realtime.',
      };
  }
}

/** Stable key for the aria-live region: countdown ticks must not re-announce. */
export function realtimeAnnouncementKey(state: RealtimeUiState): string {
  return `${state.phase}:${state.attempt}:${state.reason}:${state.authExpired === true}`;
}

export function realtimeAnnouncement(state: RealtimeUiState, now = Date.now()): string {
  const explanation = realtimeExplanation(state, now);
  return `${realtimePhaseLabel(state.phase)}. ${explanation.reason}`;
}

export function realtimeCanRetry(state: RealtimeUiState): boolean {
  return state.phase === 'offline' && !state.authExpired;
}

export function realtimeAriaLabel(state: RealtimeUiState, presence = 0, now = Date.now()): string {
  const explanation = realtimeExplanation(state, now);
  return `Realtime connection: ${realtimeLabel(state, presence, now)}. ${explanation.reason} ${explanation.action}`;
}
