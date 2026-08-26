import type { LogEntry } from '../../../infrastructure/log-server/log-store.js';

export type LogStreamEvent = LogEntry;
export type LogStreamHub = {
  publish(event: LogStreamEvent): void;
  subscribe(listener: (event: LogStreamEvent) => void): () => void;
};
export function createLogStreamHub(): LogStreamHub {
  const listeners = new Set<(event: LogStreamEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
