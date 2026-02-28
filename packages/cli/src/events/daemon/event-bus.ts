/**
 * DaemonEventBus — lightweight typed event emitter for agent lifecycle events.
 *
 * Decouples command handlers from side-effects (cleanup, logging, state updates)
 * by letting handlers emit events while listeners handle reactions.
 *
 * Design decisions:
 * - Typed event map prevents typos and ensures payload correctness at compile time.
 * - Sync listeners are called inline; async listeners are fire-and-forget (errors logged).
 * - No external dependencies — uses a simple Map<string, Set<Function>> internally.
 */

import type { Id } from '../../api.js';

// ─── Event Definitions ──────────────────────────────────────────────────────

export interface DaemonEventMap {
  /**
   * Fired after an agent process is successfully spawned.
   * Listeners may persist PIDs, update backend, etc.
   */
  'agent:started': {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    pid: number;
    harness: string;
    model?: string;
  };

  /**
   * Fired when an agent process exits (for any reason).
   * The `intentional` flag distinguishes user-requested stops from crashes.
   */
  'agent:exited': {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    pid: number;
    code: number | null;
    signal: string | null;
    intentional: boolean;
  };

  /**
   * Fired when a stop-agent command successfully kills the process.
   */
  'agent:stopped': {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    pid: number;
  };

  /**
   * Fired when a command starts processing.
   */
  'command:processing': {
    commandId: string;
    type: string;
  };

  /**
   * Fired when a command completes (success or failure).
   */
  'command:completed': {
    commandId: string;
    type: string;
    failed: boolean;
    result: string;
  };
}

// ─── Event Bus Implementation ───────────────────────────────────────────────

export type DaemonEventName = keyof DaemonEventMap;
export type DaemonEventPayload<E extends DaemonEventName> = DaemonEventMap[E];
export type DaemonEventListener<E extends DaemonEventName> = (payload: DaemonEventMap[E]) => void;

export class DaemonEventBus {
  private listeners = new Map<string, Set<Function>>();

  /**
   * Register a listener for a specific event.
   * Returns an unsubscribe function.
   */
  on<E extends DaemonEventName>(event: E, listener: DaemonEventListener<E>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /**
   * Emit an event. All registered listeners are called synchronously.
   * Errors in listeners are caught and logged to prevent one bad listener
   * from breaking the emitter or other listeners.
   */
  emit<E extends DaemonEventName>(event: E, payload: DaemonEventMap[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;

    for (const listener of set) {
      try {
        listener(payload);
      } catch (err) {
        console.warn(`[EventBus] Listener error on "${event}": ${(err as Error).message}`);
      }
    }
  }

  /** Remove all listeners (useful for tests and shutdown). */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
