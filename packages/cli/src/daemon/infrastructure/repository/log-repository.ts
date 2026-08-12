import type { DatabaseSync } from 'node:sqlite';
import { queryAfterId, queryHistory, listDistinctSources, type StoredLogEntry } from '../../../infrastructure/log-server/log-store.js';
import type { LogHistoryReader } from '../../domain/usecase/list-log-history.js';
export type LogRepository = LogHistoryReader;
export function createLogRepository(db: DatabaseSync): LogRepository {
  return {
    queryAfterId(afterId = 0, limit = 100, source?: string): StoredLogEntry[] { return queryAfterId(db, afterId, limit, source); },
    queryHistory(beforeId?: number, limit = 100, source?: string): StoredLogEntry[] { return queryHistory(db, beforeId, limit, source); },
    listSources(limit = 100): string[] { return listDistinctSources(db, limit); },
  };
}
