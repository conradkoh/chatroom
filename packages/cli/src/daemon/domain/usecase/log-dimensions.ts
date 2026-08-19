import { listLogDimensions, type LogHistoryReader } from './list-log-history.js';
import type { LogDimensions } from '../../../infrastructure/log-server/log-store.js';

export function createLogDimensionsUseCase(deps: {
  reader: LogHistoryReader & { listDimensions?: (limit?: number) => LogDimensions };
}) {
  return (limit?: number) => listLogDimensions(deps.reader, limit);
}
