import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../domain/entities/outbound-event.js';

export type HarnessStreamLine = Extract<OutboundEvent, { type: 'harness.stream' }>;

export function listHarnessStreamLines(
  db: DatabaseSync,
  opts: { harness?: string | undefined; limit?: number | undefined } = {}
): HarnessStreamLine[] {
  const limit = opts.limit ?? 500;
  const rows = db
    .prepare(
      `SELECT payload_json FROM outbound_events
       WHERE event_type = 'harness.stream'
       ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as { payload_json: string }[];

  const parsed = rows
    .map((row) => JSON.parse(row.payload_json) as HarnessStreamLine)
    .filter((event) => event.type === 'harness.stream');

  if (!opts.harness) return parsed.reverse();
  return parsed.filter((e) => e.harness === opts.harness).reverse();
}
