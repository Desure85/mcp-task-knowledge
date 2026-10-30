/**
 * web-ui/components/live-status.ts — Realtime status bridge.
 *
 * The tasks board owns the single WebSocket (via useRealtime). It mirrors the
 * connection state into this tiny external store so the top bar can render the
 * same live/reconnecting/offline pill without opening a second socket.
 */

'use client';

import { useSyncExternalStore } from 'react';
import type { ConnectionStatus } from '@/lib/realtime';

export type LiveState = {
  status: ConnectionStatus | null;
  presence: number;
};

let state: LiveState = { status: null, presence: 0 };
const listeners = new Set<() => void>();

function emit(next: LiveState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function publishLiveStatus(status: ConnectionStatus, presence: number) {
  if (state.status === status && state.presence === presence) return;
  emit({ status, presence });
}

export function clearLiveStatus() {
  if (state.status === null && state.presence === 0) return;
  emit({ status: null, presence: 0 });
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
