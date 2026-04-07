/**
 * EventBus — Internal pub/sub event bus (MW-002)
 *
 * Provides a typed, async-capable event bus for intra-server communication.
 * Decouples components so they can react to server events without
 * direct dependencies on each other.
 *
 * Architecture:
 *   ┌──────────────┐    publish     ┌──────────────┐
 *   │  ToolExecutor │ ──────────→   │   EventBus    │
 *   └──────────────┘                │              │
 *   ┌──────────────┐                │  subscribers │
 *   │ SessionMgr   │ ──────────→   │  (listeners) │
 *   └──────────────┘                └──────┬───────┘
 *                                   ┌──────┼───────┐
 *                                   ▼      ▼       ▼
 *                                Logger  Metrics  Rules
 *
 * Event topics:
 *   - tool.called       — after every tool call
 *   - tool.error        — when a tool call fails
 *   - tool.denied       — when a tool call is denied by policy
 *   - session.opened    — new session created
 *   - session.closed    — session removed (TTL, idle, explicit)
 *   - session.heartbeat — session heartbeat received
 *   - server.started    — app container entered 'running' state
 *   - server.stopped    — app container entered 'stopped' state
 *   - custom.*          — any user-defined topic
 *
 * Design principles:
 *   - Typed payloads: each topic has a strongly-typed event payload
 *   - Async dispatch: listeners can be async, errors don't block other listeners
 *   - Wildcard subscriptions: subscribe to 'tool.*' to catch all tool events
 *   - Ordered delivery: listeners for the same topic called in subscription order
 *   - Lifecycle aware: integrate with AppContainer for cleanup on shutdown
 *   - Zero dependencies: no external packages
 */

import { childLogger } from './logger.js';

const log = childLogger('event-bus');

// ─── Event Types ──────────────────────────────────────────────────────

/**
 * Base event interface. All events carry a timestamp and optional metadata.
 */
export interface BaseEvent {
  /** Event emission timestamp (ms). */
  readonly timestamp: number;
  /** Optional metadata bag for extensibility. */
  readonly meta?: Record<string, unknown>;
}

// ─── Tool Events ─────────────────────────────────────────────────────

export interface ToolCalledEvent extends BaseEvent {
  readonly type: 'tool.called';
  readonly toolName: string;
  readonly sessionId: string;
  readonly userId?: string;
  readonly input: Record<string, unknown>;
  readonly result?: unknown;
  readonly durationMs: number;
}

export interface ToolErrorEvent extends BaseEvent {
  readonly type: 'tool.error';
  readonly toolName: string;
  readonly sessionId: string;
  readonly userId?: string;
  readonly input: Record<string, unknown>;
  readonly error: unknown;
  readonly durationMs: number;
}

export interface ToolDeniedEvent extends BaseEvent {
  readonly type: 'tool.denied';
  readonly toolName: string;
  readonly sessionId: string;
  readonly userId?: string;
  readonly reason: string;
}

// ─── Session Events ──────────────────────────────────────────────────

export interface SessionOpenedEvent extends BaseEvent {
  readonly type: 'session.opened';
  readonly sessionId: string;
  readonly remote: string;
  readonly userId?: string;
}

export interface SessionClosedEvent extends BaseEvent {
  readonly type: 'session.closed';
  readonly sessionId: string;
  readonly reason: 'ttl' | 'idle' | 'explicit' | 'shutdown';
}

export interface SessionHeartbeatEvent extends BaseEvent {
  readonly type: 'session.heartbeat';
  readonly sessionId: string;
}

// ─── Server Events ──────────────────────────────────────────────────

export interface ServerStartedEvent extends BaseEvent {
  readonly type: 'server.started';
  readonly transport: string;
  readonly port?: number;
  readonly toolCount: number;
}

export interface ServerStoppedEvent extends BaseEvent {
  readonly type: 'server.stopped';
  readonly reason: 'signal' | 'error' | 'explicit';
  readonly uptimeMs: number;
}

// ─── Custom Event ────────────────────────────────────────────────────

export interface CustomEvent extends BaseEvent {
  readonly type: string;
  readonly data: unknown;
}

// ─── Union type ──────────────────────────────────────────────────────

/** All built-in event types. */
export type ServerEvent =
  | ToolCalledEvent
  | ToolErrorEvent
  | ToolDeniedEvent
  | SessionOpenedEvent
  | SessionClosedEvent
  | SessionHeartbeatEvent
  | ServerStartedEvent
  | ServerStoppedEvent;

/** Any event (built-in or custom). */
export type AnyEvent = ServerEvent | CustomEvent;

// ─── Listener ────────────────────────────────────────────────────────

/**
 * Event listener callback.
 * Can be sync or async. Errors are caught and logged (non-fatal).
 */
export type EventListener<T extends AnyEvent = AnyEvent> = (
  event: T,
) => void | Promise<void>;

/**
 * Unsubscribe function returned by subscribe().
 * Call to remove the listener.
 */
export type Unsubscribe = () => void;

// ─── EventBus ────────────────────────────────────────────────────────

/**
 * Internal pub/sub event bus for server-wide event dispatch.
 *
 * Usage:
 *   const bus = new EventBus();
 *
 *   // Subscribe
 *   const unsub = bus.on('tool.called', (event) => {
 *     console.log(`Tool ${event.toolName} took ${event.durationMs}ms`);
 *   });
 *
 *   // Wildcard
 *   bus.on('session.*', (event) => { ... });
 *
 *   // Publish
 *   bus.emit({ type: 'tool.called', timestamp: Date.now(), toolName: 'greet', ... });
 *
 *   // Cleanup
 *   unsub();
 *   // Or remove all listeners for a topic:
 *   bus.removeAllListeners('tool.called');
 *   // Or shutdown all:
 *   bus.removeAllListeners();
 */
export class EventBus {
  private listeners = new Map<string, Set<EventListener>>();
  private wildcardListeners = new Map<string, Set<EventListener>>();
  private _shutdown = false;

  /**
   * Subscribe to a specific event topic.
   *
   * @param topic - exact topic name (e.g. 'tool.called') or wildcard pattern ('tool.*')
   * @param listener - callback to invoke when event matches
   * @returns unsubscribe function
   */
  on<T extends AnyEvent>(topic: string, listener: EventListener<T>): Unsubscribe {
    if (this._shutdown) {
      log.warn({ topic }, 'cannot subscribe after shutdown');
      return () => {};
    }

    const map = topic.includes('*') ? this.wildcardListeners : this.listeners;
    if (!map.has(topic)) {
      map.set(topic, new Set());
    }
    map.get(topic)!.add(listener as EventListener);

    log.debug({ topic, totalListeners: this.listenerCount() }, 'listener subscribed');
    return () => {
      const set = map.get(topic);
      if (set) {
        set.delete(listener as EventListener);
        if (set.size === 0) map.delete(topic);
      }
    };
  }

  /**
   * Subscribe to a topic, but only fire once then auto-unsubscribe.
   */
  once<T extends AnyEvent>(topic: string, listener: EventListener<T>): Unsubscribe {
    const unsub = this.on<T>(topic, ((event: T) => {
      unsub();
      return listener(event);
    }) as EventListener<T>);
    return unsub;
  }

  /**
   * Emit an event to all matching listeners.
   *
   * Delivery order:
   *   1. Exact topic listeners (in subscription order)
   *   2. Wildcard pattern listeners (in subscription order)
   *
   * Errors in listeners are caught and logged — they don't stop
   * delivery to subsequent listeners.
   *
   * @returns promise that resolves when all listeners have completed
   */
  async emit(event: AnyEvent): Promise<void> {
    if (this._shutdown) {
      log.warn({ type: event.type }, 'emit after shutdown (ignored)');
      return;
    }

    const topic = event.type;
    const promises: Promise<void>[] = [];

    // 1. Exact topic listeners
    const exact = this.listeners.get(topic);
    if (exact) {
      for (const listener of exact) {
        promises.push(this.safeCall(listener, event, topic));
      }
    }

    // 2. Wildcard listeners
    for (const [pattern, set] of this.wildcardListeners) {
      if (this.matchWildcard(pattern, topic)) {
        for (const listener of set) {
          promises.push(this.safeCall(listener, event, pattern));
        }
      }
    }

    await Promise.all(promises);
  }

  /**
   * Remove all listeners for a specific topic.
   * If no topic specified, removes ALL listeners (full reset).
   */
  removeAllListeners(topic?: string): void {
    if (topic) {
      this.listeners.delete(topic);
      // Also remove wildcards that match
      for (const pattern of [...this.wildcardListeners.keys()]) {
        if (this.matchWildcard(pattern, topic)) {
          this.wildcardListeners.delete(pattern);
        }
      }
      log.debug({ topic }, 'listeners removed for topic');
    } else {
      this.listeners.clear();
      this.wildcardListeners.clear();
      log.debug('all listeners removed');
    }
  }

  /**
   * Get count of listeners (exact + wildcard) for diagnostics.
   */
  listenerCount(topic?: string): number {
    if (topic) {
      let count = this.listeners.get(topic)?.size ?? 0;
      for (const [pattern, set] of this.wildcardListeners) {
        if (this.matchWildcard(pattern, topic)) {
          count += set.size;
        }
      }
      return count;
    }
    // Total across all topics
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    for (const set of this.wildcardListeners.values()) total += set.size;
    return total;
  }

  /**
   * Get list of subscribed topics (exact matches only, for diagnostics).
   */
  getTopics(): string[] {
    return [...this.listeners.keys()];
  }

  /**
   * Check if any listeners exist for a topic.
   */
  hasListeners(topic: string): boolean {
    if ((this.listeners.get(topic)?.size ?? 0) > 0) return true;
    for (const [pattern, set] of this.wildcardListeners) {
      if (this.matchWildcard(pattern, topic) && set.size > 0) return true;
    }
    return false;
  }

  /**
   * Shutdown the event bus. Prevents new subscriptions and emissions.
   * Existing listeners are NOT auto-removed — call removeAllListeners()
   * first if cleanup is needed.
   */
  shutdown(): void {
    this._shutdown = true;
    log.info('event bus shutdown');
  }

  /**
   * Whether the event bus has been shut down.
   */
  get isShutdown(): boolean {
    return this._shutdown;
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Call a listener safely — catch errors and log them.
   */
  private async safeCall(
    listener: EventListener,
    event: AnyEvent,
    topic: string,
  ): Promise<void> {
    try {
      await listener(event);
    } catch (err) {
      log.error(
        { topic, eventType: event.type, err },
        'event listener error (non-fatal)',
      );
    }
  }

  /**
   * Simple wildcard matching.
   * Supports single '*' at the end of pattern: 'tool.*' matches 'tool.called', 'tool.error'.
   * Does NOT support deep wildcards like 'a.*.b' — use separate subscriptions.
   */
  private matchWildcard(pattern: string, topic: string): boolean {
    if (!pattern.includes('*')) return pattern === topic;
    // Only support trailing wildcard: 'prefix.*'
    const prefix = pattern.slice(0, -1); // remove '*'
    return topic.startsWith(prefix);
  }
}

// ─── Singleton (lazy) ───────────────────────────────────────────────

let _instance: EventBus | undefined;

/**
 * Get the global EventBus singleton.
 * Created on first access. Use resetEventBus() for testing.
 */
export function getEventBus(): EventBus {
  if (!_instance) {
    _instance = new EventBus();
  }
  return _instance;
}

/**
 * Reset the global EventBus singleton (testing only).
 */
export function resetEventBus(): void {
  if (_instance) {
    _instance.removeAllListeners();
    _instance.shutdown();
  }
  _instance = undefined;
}
