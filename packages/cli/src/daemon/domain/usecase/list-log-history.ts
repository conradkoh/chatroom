import type {
  StoredLogEntry,
  LogDimensions,
} from '../../../infrastructure/log-server/log-store.js';
import type { LogHistoryQuery } from '../entities/log-history-query.js';

export type LogHistoryReader = {
  queryAfterId(
    afterId?: number,
    limit?: number,
    source?: string,
    chatroomId?: string,
    role?: string,
    harness?: string,
    fromTimestamp?: number,
    toTimestamp?: number
  ): StoredLogEntry[];
  queryHistory(
    beforeId?: number,
    limit?: number,
    source?: string,
    chatroomId?: string,
    role?: string,
    harness?: string,
    fromTimestamp?: number,
    toTimestamp?: number
  ): StoredLogEntry[];
  listSources(limit?: number): string[];
};
export type LogHistoryResult = { entries: StoredLogEntry[] };
export function listLogHistory(reader: LogHistoryReader, input: LogHistoryQuery): LogHistoryResult {
  const limit = input.limit ?? 500;
  const entries =
    input.afterId !== undefined
      ? reader.queryAfterId(
          input.afterId,
          limit,
          input.source,
          input.chatroomId,
          input.role,
          input.harness,
          input.fromTimestamp,
          input.toTimestamp
        )
      : reader.queryHistory(
          input.beforeId,
          limit,
          input.source,
          input.chatroomId,
          input.role,
          input.harness,
          input.fromTimestamp,
          input.toTimestamp
        );
  return { entries };
}
export function listLogDimensions(
  reader: LogHistoryReader & {
    listDimensions?: (chatroomId: string, limit?: number) => LogDimensions;
  },
  chatroomId: string,
  limit = 100
): LogDimensions {
  return reader.listDimensions
    ? reader.listDimensions(chatroomId, limit)
    : { roles: [], harnesses: [] };
}
export function listLogSources(reader: LogHistoryReader, limit = 100): { sources: string[] } {
  return { sources: reader.listSources(limit) };
}
