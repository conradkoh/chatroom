/**
 * eventCleanup — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

async function insertEvent(timestamp: number): Promise<Id<'chatroom_eventStream'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.ping',
      machineId: 'test-machine',
      timestamp,
    });
  });
}

describe('eventCleanup.cleanupOldEvents', () => {
  test('deletes events older than 24 hours by timestamp', async () => {
    const staleTimestamp = Date.now() - MAX_EVENT_AGE_MS - 60_000;
    const staleId = await insertEvent(staleTimestamp);

    await t.mutation(internal.eventCleanup.cleanupOldEvents, {});

    const row = await t.run(async (ctx) => ctx.db.get(staleId));
    expect(row).toBeNull();
  });

  test('retains events within the 24-hour retention window', async () => {
    const freshTimestamp = Date.now() - 60_000;
    const freshId = await insertEvent(freshTimestamp);

    await t.mutation(internal.eventCleanup.cleanupOldEvents, {});

    const row = await t.run(async (ctx) => ctx.db.get(freshId));
    expect(row).not.toBeNull();
    expect(row!.timestamp).toBe(freshTimestamp);
  });

  test('deletes only stale events when batch contains mixed ages', async () => {
    const staleId = await insertEvent(Date.now() - MAX_EVENT_AGE_MS - 60_000);
    const freshId = await insertEvent(Date.now() - 60_000);

    await t.mutation(internal.eventCleanup.cleanupOldEvents, {});

    const stale = await t.run(async (ctx) => ctx.db.get(staleId));
    const fresh = await t.run(async (ctx) => ctx.db.get(freshId));
    expect(stale).toBeNull();
    expect(fresh).not.toBeNull();
  });
});
