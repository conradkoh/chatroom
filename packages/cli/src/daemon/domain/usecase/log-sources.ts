import { listLogSources, type LogHistoryReader } from './list-log-history.js';

export function createLogSourcesUseCase(deps: { reader: LogHistoryReader }) {
  return (limit?: number) => listLogSources(deps.reader, limit);
}
