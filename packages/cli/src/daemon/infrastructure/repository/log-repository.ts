import type { DatabaseSync } from 'node:sqlite';

import {
  queryAfterId,
  queryHistory,
  listDistinctSources,
  listLogDimensions,
  type StoredLogEntry,
  type LogDimensions,
} from '../../../infrastructure/log-server/log-store.js';
import type { LogHistoryReader } from '../../domain/usecase/list-log-history.js';

export type LogRepository = LogHistoryReader & { listDimensions(limit?: number): LogDimensions };
export function createLogRepository(db: DatabaseSync): LogRepository {
  return {
    queryAfterId(
      afterId = 0,
      limit = 100,
      source?: string,
      chatroomId?: string,
      role?: string,
      harness?: string
    ): StoredLogEntry[] {
      return queryAfterId(db, afterId, limit, source, chatroomId, role, harness);
    },
    queryHistory(
      beforeId?: number,
      limit = 100,
      source?: string,
      chatroomId?: string,
      role?: string,
      harness?: string
    ): StoredLogEntry[] {
      return queryHistory(db, beforeId, limit, source, chatroomId, role, harness);
    },
    listSources(limit = 100): string[] {
      return listDistinctSources(db, limit);
    },
    listDimensions(limit = 100): LogDimensions {
      return listLogDimensions(db, limit);
    },
  };
}
