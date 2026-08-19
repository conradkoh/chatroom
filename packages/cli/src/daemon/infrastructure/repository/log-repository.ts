import type { DatabaseSync } from 'node:sqlite';

import {
  queryAfterId,
  queryHistory,
  listDistinctSources,
  listLogDimensions,
  appendChatroomEvent,
  queryEventStream,
  type ChatroomEventRecord,
  type EventStreamEntry,
  type StoredLogEntry,
  type LogDimensions,
} from '../../../infrastructure/log-server/log-store.js';
import type { LogHistoryReader } from '../../domain/usecase/list-log-history.js';
import type { EventStreamQuery } from '../../domain/entities/event-stream-query.js';

export type LogRepository = LogHistoryReader & {
  listDimensions(limit?: number): LogDimensions;
  writeChatroomEvent(event: ChatroomEventRecord): void;
  queryEventStream(input: EventStreamQuery): EventStreamEntry[];
};
export function createLogRepository(db: DatabaseSync): LogRepository {
  return {
    queryAfterId(
      afterId = 0,
      limit = 100,
      source?: string,
      chatroomId?: string,
      role?: string,
      harness?: string,
      fromTimestamp?: number,
      toTimestamp?: number
    ): StoredLogEntry[] {
      return queryAfterId(
        db,
        afterId,
        limit,
        source,
        chatroomId,
        role,
        harness,
        fromTimestamp,
        toTimestamp
      );
    },
    queryHistory(
      beforeId?: number,
      limit = 100,
      source?: string,
      chatroomId?: string,
      role?: string,
      harness?: string,
      fromTimestamp?: number,
      toTimestamp?: number
    ): StoredLogEntry[] {
      return queryHistory(
        db,
        beforeId,
        limit,
        source,
        chatroomId,
        role,
        harness,
        fromTimestamp,
        toTimestamp
      );
    },
    listSources(limit = 100): string[] {
      return listDistinctSources(db, limit);
    },
    listDimensions(limit = 100): LogDimensions {
      return listLogDimensions(db, limit);
    },
    writeChatroomEvent(event: ChatroomEventRecord): void {
      appendChatroomEvent(db, event);
    },
    queryEventStream(input: EventStreamQuery): EventStreamEntry[] {
      return queryEventStream(db, input);
    },
  };
}
