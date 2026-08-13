import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import { loadOutboundEventById } from '../persistence/event-store.js';
import {
  incrementOutboxAttempts,
  listPendingOutbox,
  markOutboxDone,
  markOutboxFailed,
} from '../persistence/outbox.js';

export type OutboxDrainWorkerDeps = {
  db: DatabaseSync;
  projectEvent: (event: OutboundEvent) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number; // default 5
  limit?: number; // default 100 rows per tick
};

export type OutboxDrainWorkerHandle = { stop(): void };

export type OutboxDrainTickResult = {
  processed: number;
  failed: number;
};

// fallow-ignore-next-line complexity unused-export
export async function drainOutboxOnce(deps: OutboxDrainWorkerDeps): Promise<OutboxDrainTickResult> {
  const maxAttempts = deps.maxAttempts ?? 5;
  const rows = listPendingOutbox(deps.db, deps.limit ?? 100);
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    const event = loadOutboundEventById(deps.db, row.outboundEventId);
    if (!event) {
      markOutboxFailed(deps.db, row.id, 'Outbound event not found');
      failed += 1;
      continue;
    }

    try {
      await deps.projectEvent(event);
      markOutboxDone(deps.db, row.id);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = incrementOutboxAttempts(deps.db, row.id, message);
      if (attempts >= maxAttempts) {
        markOutboxFailed(deps.db, row.id, message);
        failed += 1;
      }
    }
  }

  return { processed, failed };
}

export function startOutboxDrainWorker(deps: OutboxDrainWorkerDeps): OutboxDrainWorkerHandle {
  const interval = setInterval(() => {
    void drainOutboxOnce(deps).catch((error) => {
      console.error('[daemon] Outbox drain tick failed:', error);
    });
  }, deps.pollIntervalMs ?? 5000);
  interval.unref?.();

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
