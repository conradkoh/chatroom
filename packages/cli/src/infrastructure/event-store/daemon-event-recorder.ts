import type { EventStore } from './types';

/**
 * Wraps a local event-store append around a Convex publish so daemon-originated
 * events are dual-written. Local append is best-effort: a failure is logged and
 * the Convex publish still proceeds (existing behavior preserved).
 */
export class DaemonEventRecorder {
  constructor(
    private readonly store: EventStore,
    private readonly machineId: string
  ) {}

  // fallow-ignore-next-line unused-class-member
  async appendAndPublish<T>(
    event: {
      chatroomId: string;
      type: string;
      timestamp: number;
      payload: Record<string, unknown>;
    },
    publish: () => Promise<T>
  ): Promise<T> {
    try {
      this.store.append({
        chatroomId: event.chatroomId,
        machineId: this.machineId,
        type: event.type,
        timestamp: event.timestamp,
        payload: JSON.stringify(event.payload),
      });
    } catch (err) {
      console.error('[event-store] local append failed:', err);
    }
    return publish();
  }
}

/**
 * Recorder that skips local storage and only publishes — for tests and any
 * context where the SQLite store is unavailable.
 */
export function createNoopEventRecorder(machineId = ''): DaemonEventRecorder {
  const store: EventStore = {
    append: () => '',
    listByChatroom: () => ({ page: [], continueCursor: null, isDone: true }),
    close: () => {},
  };
  return new DaemonEventRecorder(store, machineId);
}
