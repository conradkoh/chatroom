import type { DatabaseSync } from 'node:sqlite';

import { appendOutboundEvent } from './event-store.js';
import { openDatabase } from './open-database.js';
import { enqueueOutbox, listPendingOutbox } from './outbox.js';
import { listHarnessStreamLines } from './read-model.js';
import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import { shouldEnqueueOutbox } from '../projection/sync-policy.js';

export type PersistenceStore = {
  /** Internal database handle for the outbox drain worker. */
  readonly db: DatabaseSync;
  append(event: OutboundEvent): void;
  listHarnessStreamLines(opts?: {
    harness?: string;
    limit?: number;
  }): ReturnType<typeof listHarnessStreamLines>;
  listPendingOutbox(limit?: number): ReturnType<typeof listPendingOutbox>;
  close(): void;
};

export function createPersistenceStore(dbPath: string): PersistenceStore {
  const db: DatabaseSync = openDatabase(dbPath);
  return {
    db,
    append(event) {
      const eventId = appendOutboundEvent(db, event);
      if (shouldEnqueueOutbox(event)) {
        enqueueOutbox(db, eventId);
      }
    },
    listHarnessStreamLines: (opts) => listHarnessStreamLines(db, opts),
    listPendingOutbox: (limit) => listPendingOutbox(db, limit),
    close() {
      db.close();
    },
  };
}
