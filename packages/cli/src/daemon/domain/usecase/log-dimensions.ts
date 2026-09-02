import { listLogDimensions, type LogHistoryReader } from './list-log-history.js';
import type { LogDimensions } from '../../../infrastructure/log-server/log-store.js';
import type { LogDimensionsQuery } from '../entities/log-dimensions-query.js';

export function createLogDimensionsUseCase(deps: {
  reader: LogHistoryReader & {
    listDimensions?:( (chatroomId: string, limit?: number) => LogDimensions) | undefined;
  };
}) {
  return (input: LogDimensionsQuery) =>
    listLogDimensions(deps.reader, input.chatroomId, input.limit);
}
