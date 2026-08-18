import type { DatabaseSync } from 'node:sqlite';

import {
  queryAfterId,
  queryHistory,
  listDistinctSources,
  listLogDimensions,
  appendChatroomEvent,
  type ChatroomEventRecord,
  type StoredLogEntry,
  type LogDimensions,
} from '../../../infrastructure/log-server/log-store.js';
import type { LogHistoryReader } from '../../domain/usecase/list-log-history.js';

export type LogRepository = LogHistoryReader & {
  listDimensions(limit?: number): LogDimensions;
  writeChatroomEvent(event: ChatroomEventRecord): void;
};
export function createLogRepository(db: DatabaseSync): LogRepository {
  return {
    queryAfterId(
      afterId = 0,
      limit = 100,
      source?: string,
      chatroomId?: string,
      role?: string,
      harness?: string, fromTimestamp?: number, toTimestamp?: number
    ): StoredLogEntry[] {
      return queryAfterId(db, afterId, limit, source, chatroomId, role, harness, fromTimestamp, toTimestamp);
    },
    queryHistory(
      beforeId?: number,
      limit = 100,
      source?: string,
      chatroomId?: string,
      role?: string,
      harness?: string, fromTimestamp?: number, toTimestamp?: number
    ): StoredLogEntry[] {
      return queryHistory(db, beforeId, limit, source, chatroomId, role, harness, fromTimestamp, toTimestamp);
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
  };
}
