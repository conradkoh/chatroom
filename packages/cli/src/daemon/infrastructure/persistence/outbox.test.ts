import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appendOutboundEvent } from './event-store.js';
import { openDatabase } from './open-database.js';
import {
  enqueueOutbox,
  incrementOutboxAttempts,
  listPendingOutbox,
  markOutboxDone,
  markOutboxFailed,
} from './outbox.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-outbox-'));
  return join(dir, 'events.sqlite');
}

function getOutboxRow(db: ReturnType<typeof openDatabase>, id: number) {
  return db
    .prepare(`SELECT id, status, attempts, last_error, target FROM outbox WHERE id = ?`)
    .get(id) as {
    id: number;
    status: string;
    attempts: number;
    last_error: string | null;
    target: string;
  };
}

describe('outbox', () => {
  it('enqueues pending row linked to outbound event', () => {
    const db = openDatabase(tempDbPath());
    try {
      const eventId = appendOutboundEvent(db, {
        type: 'command.result.ping',
        pingEventId: 'ping-1',
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

  it('markOutboxDone sets status to done and clears pending', () => {
    const db = openDatabase(tempDbPath());
    try {
      const eventId = appendOutboundEvent(db, { type: 'heartbeat', machineId: 'm-1' });
      const outboxId = enqueueOutbox(db, eventId);

      markOutboxDone(db, outboxId);

      expect(getOutboxRow(db, outboxId).status).toBe('done');
      expect(listPendingOutbox(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('markOutboxFailed sets status to failed with last_error', () => {
    const db = openDatabase(tempDbPath());
    try {
      const eventId = appendOutboundEvent(db, { type: 'heartbeat', machineId: 'm-1' });
      const outboxId = enqueueOutbox(db, eventId);

      markOutboxFailed(db, outboxId, 'boom');

      const row = getOutboxRow(db, outboxId);
      expect(row.status).toBe('failed');
      expect(row.last_error).toBe('boom');
    } finally {
      db.close();
    }
  });

  it('incrementOutboxAttempts increments attempts and records last_error', () => {
    const db = openDatabase(tempDbPath());
    try {
      const eventId = appendOutboundEvent(db, { type: 'heartbeat', machineId: 'm-1' });
      const outboxId = enqueueOutbox(db, eventId);

      const attempts = incrementOutboxAttempts(db, outboxId, 'retry');

      expect(attempts).toBe(1);
      const row = getOutboxRow(db, outboxId);
      expect(row.attempts).toBe(1);
      expect(row.last_error).toBe('retry');
      expect(row.status).toBe('pending');
    } finally {
      db.close();
    }
  });
});
