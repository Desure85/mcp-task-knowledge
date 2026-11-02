/**
 * web-ui/components/live-status.ts — Realtime status bridge.
 *
 * A page with a realtime hook publishes its detailed state here; the Topbar
 * renders one indicator for every route without opening a second socket. The
 * owner argument makes overlapping hooks safe: a stale unmount cannot clear a
 * newer owner's state.
 */

'use client';

import { useSyncExternalStore } from 'react';
import type { ConnectionStatus } from '../lib/realtime';
import {
  createRealtimeState,
  statusForPhase,
  type RealtimeUiState,
} from '../lib/realtime-state';

export type LiveState = {
  status: ConnectionStatus | null;
  presence: number;
  state: RealtimeUiState | null;
};

let state: LiveState = { status: null, presence: 0, state: null };
let owner: string | null = null;
const listeners = new Set<() => void>();

function emit(next: LiveState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function stateForStatus(status: ConnectionStatus): RealtimeUiState {
  const base = createRealtimeState({ configured: true });
  switch (status) {
    case 'connected':
      return { ...base, phase: 'live', attempt: 0, reason: 'open' };
    case 'connecting':
      return base;
    case 'reconnecting':
      return { ...base, phase: 'reconnecting', reason: 'connection-lost' };
    case 'unavailable':
      return { ...base, phase: 'offline', reason: 'connect-failed' };
    case 'closed':
      return { ...base, phase: 'disabled', reason: 'not-configured', configured: false };
  }
}

/** Publish the full state from the realtime hook that currently owns the page. */
export function publishRealtimeState(ownerId: string, next: RealtimeUiState, presence: number) {
  owner = ownerId;
  const status = statusForPhase(next.phase);
  if (
    state.status === status
    && state.presence === presence
    && state.state === next
  ) return;
  emit({ status, presence, state: next });
}

/** Clear only if the caller is still the owner (prevents unmount races). */
export function clearRealtimeState(ownerId: string) {
  if (owner !== ownerId) return;
  owner = null;
  if (state.status === null && state.presence === 0 && state.state === null) return;
  emit({ status: null, presence: 0, state: null });
}

/**
 * Backwards-compatible manual bridge used by the Tasks page. It keeps the
 * detailed state when the status agrees, otherwise synthesizes the minimum
 * state needed by the indicator.
 */
export function publishLiveStatus(status: ConnectionStatus, presence: number) {
  const nextState =
    state.state && statusForPhase(state.state.phase) === status
      ? state.state
      : stateForStatus(status);
  if (state.status === status && state.presence === presence && state.state === nextState) return;
  emit({ status, presence, state: nextState });
}

export function clearLiveStatus() {
  owner = null;
  if (state.status === null && state.presence === 0 && state.state === null) return;
  emit({ status: null, presence: 0, state: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

export function useLiveStatus(): LiveState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
