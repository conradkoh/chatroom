import type { HarnessHistoryQuery } from '../entities/harness-history-query.js';
import type { OutboundEvent } from '../entities/outbound-event.js';

export type HarnessStreamLine = Extract<OutboundEvent, { type: 'harness.stream' }>;

export type HarnessStreamReader = {
  listLines(opts?: HarnessHistoryQuery): HarnessStreamLine[];
};

export type HarnessHistoryResult = {
  lines: HarnessStreamLine[];
};

export function listHarnessHistory(
  reader: HarnessStreamReader,
  input: HarnessHistoryQuery = {}
): HarnessHistoryResult {
  const lines = reader.listLines({
    harness: input.harness,
    limit: input.limit ?? 500,
  });
  return { lines };
}
