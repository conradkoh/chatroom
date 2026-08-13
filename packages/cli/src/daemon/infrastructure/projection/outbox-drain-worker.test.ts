import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainOutboxOnce } from './outbox-drain-worker.js';
import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import { appendOutboundEvent } from '../persistence/event-store.js';
import { openDatabase } from '../persistence/open-database.js';
import { enqueueOutbox, listPendingOutbox } from '../persistence/outbox.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-outbox-drain-'));
  return join(dir, 'events.sqlite');
}

function enqueue(db: ReturnType<typeof openDatabase>, event: OutboundEvent): void {
  const eventId = appendOutboundEvent(db, event);
  enqueueOutbox(db, eventId);
}

function outboxStatuses(db: ReturnType<typeof openDatabase>): {
  status: string;
  attempts: number;
  last_error: string | null;
}[] {
  return db.prepare(`SELECT status, attempts, last_error FROM outbox ORDER BY id ASC`).all() as {
    status: string;
    attempts: number;
    last_error: string | null;
  }[];
}

describe('drainOutboxOnce', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(tempDbPath());
  });

  afterEach(() => {
    db.close();
  });

  it('handles empty outbox without error', async () => {
    const result = await drainOutboxOnce({
      db,
      projectEvent: vi.fn(),
    });

    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it('shadow mode validates but does not project, then marks done', async () => {
    enqueue(db, { type: 'heartbeat', machineId: 'm-1' });
    const projectEvent = vi.fn();

    const result = await drainOutboxOnce({
      db,
      projectEvent,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(projectEvent).toHaveBeenCalledWith({ type: 'heartbeat', machineId: 'm-1' });
    expect(outboxStatuses(db)[0]?.status).toBe('done');
  });

  it('cutover mode projects to convex and marks done', async () => {
    enqueue(db, { type: 'heartbeat', machineId: 'm-1' });
    const projectEvent = vi.fn().mockResolvedValue(undefined);

    const result = await drainOutboxOnce({
      db,
      projectEvent,
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(projectEvent).toHaveBeenCalledWith({ type: 'heartbeat', machineId: 'm-1' });
    expect(outboxStatuses(db)[0]?.status).toBe('done');
  });

  it('failure increments attempts and marks failed after max attempts', async () => {
    enqueue(db, { type: 'heartbeat', machineId: 'm-1' });
    const projectEvent = vi.fn().mockRejectedValue(new Error('convex down'));
    const deps = {
      db,
      projectEvent,
      maxAttempts: 3,
    };

    const first = await drainOutboxOnce(deps);
    expect(first).toEqual({ processed: 0, failed: 0 });
    expect(outboxStatuses(db)[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'convex down',
    });

    await drainOutboxOnce(deps);
    expect(outboxStatuses(db)[0]).toMatchObject({ status: 'pending', attempts: 2 });

    const third = await drainOutboxOnce(deps);
    expect(third).toEqual({ processed: 0, failed: 1 });
    expect(outboxStatuses(db)[0]?.status).toBe('failed');
    expect(listPendingOutbox(db)).toHaveLength(0);
  });

  it('marks row failed when outbound event is missing', async () => {
    const eventId = appendOutboundEvent(db, { type: 'heartbeat', machineId: 'm-1' });
    const outboxId = enqueueOutbox(db, eventId);
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM outbound_events WHERE id = ?').run(eventId);
    db.exec('PRAGMA foreign_keys = ON');

    const result = await drainOutboxOnce({
      db,
      projectEvent: vi.fn(),
    });

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(outboxStatuses(db)[0]).toMatchObject({
      status: 'failed',
      last_error: 'Outbound event not found',
    });
    expect(listPendingOutbox(db)).toHaveLength(0);
    expect(outboxId).toBeGreaterThan(0);
  });
});
