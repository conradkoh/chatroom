import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appendOutboundEvent } from './event-store.js';
import { openDatabase } from './open-database.js';
import { enqueueOutbox, listPendingOutbox } from './outbox.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-outbox-'));
  return join(dir, 'events.sqlite');
}

describe('outbox', () => {
  it('enqueues pending row linked to outbound event', () => {
    const db = openDatabase(tempDbPath());
    try {
      const eventId = appendOutboundEvent(db, {
        type: 'command.result',
        commandId: 'cmd-1',
        success: true,
      });
      const outboxId = enqueueOutbox(db, eventId);
      expect(outboxId).toBeGreaterThan(0);

      const pending = listPendingOutbox(db);
      expect(pending).toEqual([{ id: outboxId, outboundEventId: eventId, target: 'convex' }]);
    } finally {
      db.close();
    }
  });

  it('respects limit when listing pending rows', () => {
    const db = openDatabase(tempDbPath());
    try {
      for (let i = 0; i < 3; i++) {
        const eventId = appendOutboundEvent(db, {
          type: 'heartbeat',
          machineId: `m-${i}`,
        });
        enqueueOutbox(db, eventId);
      }

      expect(listPendingOutbox(db, 2)).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});
