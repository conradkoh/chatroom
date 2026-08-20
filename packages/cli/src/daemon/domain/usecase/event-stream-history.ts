import type { EventStreamEntry } from '../../../infrastructure/log-server/log-store.js';
import type { EventStreamQuery } from '../entities/event-stream-query.js';

export type EventStreamReader = {
  queryEventStream(input: EventStreamQuery): EventStreamEntry[];
};
export type EventStreamHistoryResult = { entries: EventStreamEntry[] };

export function createEventStreamHistoryUseCase(deps: { reader: EventStreamReader }) {
  return (input: EventStreamQuery): EventStreamHistoryResult => ({
    entries: deps.reader.queryEventStream(input),
  });
}
