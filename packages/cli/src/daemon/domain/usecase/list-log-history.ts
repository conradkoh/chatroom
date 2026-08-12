import type { StoredLogEntry } from '../../../infrastructure/log-server/log-store.js';
import type { LogHistoryQuery } from '../entities/log-history-query.js';

export type LogHistoryReader = {
  queryAfterId(afterId?: number, limit?: number, source?: string): StoredLogEntry[];
  queryHistory(beforeId?: number, limit?: number, source?: string): StoredLogEntry[];
  listSources(limit?: number): string[];
};
export type LogHistoryResult = { entries: StoredLogEntry[] };
export function listLogHistory(reader: LogHistoryReader, input: LogHistoryQuery = {}): LogHistoryResult {
  const limit = input.limit ?? 500;
  const entries = input.afterId !== undefined
    ? reader.queryAfterId(input.afterId, limit, input.source)
    : reader.queryHistory(input.beforeId, limit, input.source);
  return { entries };
}
export function listLogSources(reader: LogHistoryReader, limit = 100): { sources: string[] } {
  return { sources: reader.listSources(limit) };
}
