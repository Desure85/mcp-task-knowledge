'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { connectionBadgeClass, useRealtime } from '../lib/realtime';
import {
  createRealtimeState,
  realtimeAriaLabel,
  realtimeCanRetry,
  realtimeExplanation,
  realtimeAnnouncement,
  realtimeLabel,
  realtimePhaseLabel,
  statusForPhase,
} from '../lib/realtime-state';
import { useLiveStatus } from './live-status';
import { Button } from './ui';

/**
 * One honest realtime indicator for every route. A page's useRealtime hook
 * publishes detailed state into the bridge; if no page owns realtime (Memory,
 * Analytics, …), a delayed fallback opens a status-only socket instead of
 * duplicating the page's socket.
 */
export function RealtimeIndicator() {
  const live = useLiveStatus();
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setFallbackEnabled(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const fallback = useRealtime({
    enabled: fallbackEnabled && live.state === null,
    publishGlobal: false,
    eventTypes: [],
  });
  const state = live.state ?? (fallbackEnabled ? fallback.state : null) ?? createRealtimeState();
  const presence = live.state ? live.presence : fallback.presence.length;
  const status = statusForPhase(state.phase);
  const label = realtimeLabel(state, presence, now);
  const shortLabel = realtimePhaseLabel(state.phase);
  const explanation = realtimeExplanation(state, now);
  const canRetry = realtimeCanRetry(state);

  useEffect(() => {
    if (state.retryAt === null) {
      setNow(Date.now());
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.retryAt]);

  useEffect(() => {
    const text = realtimeAnnouncement(state, Date.now());
    const timer = setTimeout(() => setAnnouncement(text), 600);
    return () => clearTimeout(timer);
    // Countdown changes must not spam the live region; phase/attempt do.
  }, [state.phase, state.attempt, state.reason, state.authExpired]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dotClass =
    state.phase === 'live'
      ? 'bg-st-done'
      : state.phase === 'offline'
        ? 'bg-st-blocked'
        : state.phase === 'disabled'
          ? 'bg-muted'
          : 'bg-st-doing';

  return (
    <div ref={wrapRef} className="relative">
      <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={realtimeAriaLabel(state, presence, now)}
        onClick={() => setOpen((value) => !value)}
        className={`max-w-[260px] rounded-full border px-2 ${connectionBadgeClass(status)}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
        <span className="hidden truncate sm:inline">{label}</span>
        <span className="truncate sm:hidden">{shortLabel}</span>
      </Button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Realtime status"
          tabIndex={-1}
          className="absolute right-0 z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-surface p-3 text-[12px] shadow-pop outline-none"
        >
          <p className="font-semibold text-ink">{explanation.title}</p>
          <p className="mt-1 text-muted">{explanation.reason}</p>
          <p className="mt-2 text-ink">{explanation.action}</p>
          {state.phase === 'disabled' && (
            <p className="mt-2 font-mono text-[11px] text-accent">NEXT_PUBLIC_MCP_WS_URL</p>
          )}
          <a
            href="https://github.com/Desure85/mcp-task-knowledge/blob/master/docs/deployment/realtime.md"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-[11px] text-accent underline"
          >
            Realtime setup guide
          </a>
          <div className="mt-3 flex justify-end gap-2">
            {state.authExpired && (
              <Link
                href="/login"
                className="inline-flex h-7 items-center rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[11px] font-medium text-ink hover:bg-surface-2"
              >
                Sign in again
              </Link>
            )}
            {canRetry && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('mcp:realtime-retry'));
                  setOpen(false);
                }}
              >
                Retry now
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}
