import { listLogHistory, type LogHistoryReader, type LogHistoryResult } from './list-log-history.js';
import type { LogHistoryQuery } from '../entities/log-history-query.js';

export function createLogHistoryUseCase(deps: { reader: LogHistoryReader }) {
  return (input: LogHistoryQuery): LogHistoryResult => listLogHistory(deps.reader, input);
}
