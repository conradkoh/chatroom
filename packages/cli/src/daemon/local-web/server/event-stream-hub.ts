import type { EventStreamEntry } from '../../../infrastructure/log-server/log-store.js';
export type EventStreamHub = { publish(event: EventStreamEntry): void; subscribe(listener: (event: EventStreamEntry) => void): () => void };
export function createEventStreamHub(): EventStreamHub {
  const listeners = new Set<(event: EventStreamEntry) => void>();
  return { publish(event) { for (const listener of listeners) listener(event); }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
