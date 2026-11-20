/**
 * Repository ledger expiry cleanup — Integration Tests
 *
 * Covers `internal.repositoryLedger.cleanupExpiredLedgerRequests`: row and
 * chunk deletion, the expiry boundary, the 100-row batch cap and the chunk
 * budget that keeps one run under the per-mutation read limit.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

const START = 1_800_000_000_000;
const COMPLETED_TTL_MS = 10 * 60_000;

async function userIdFor(sessionId: string): Promise<Id<'users'>> {
  return t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .first();
    if (!session) throw new Error(`No session for ${sessionId}`);
    return session.userId;
  });
}

type SeedOptions = {
  machineId?: string;
  status?: 'pending' | 'completed' | 'failed';
  expiresAt: number;
  chunkCount?: number;
};

/** Insert one request row and its chunks directly, bypassing the mutation lifecycle. */
async function seedRequest(
  userId: Id<'users'>,
  options: SeedOptions
): Promise<Id<'chatroom_repositoryLedgerRequests'>> {
  const machineId = options.machineId ?? 'machine-ledger-cleanup';
  const status = options.status ?? 'pending';
  return t.run(async (ctx) => {
    const requestId = await ctx.db.insert('chatroom_repositoryLedgerRequests', {
      userId,
      machineId,
      rescan: false,
      status,
      createdAt: START - COMPLETED_TTL_MS,
      updatedAt: START - COMPLETED_TTL_MS,
      expiresAt: options.expiresAt,
      ...(status === 'pending' ? {} : { completedAt: START - COMPLETED_TTL_MS }),
    });
    for (let chunkIndex = 0; chunkIndex < (options.chunkCount ?? 0); chunkIndex++) {
      await ctx.db.insert('chatroom_repositoryLedgerChunks', {
        requestId,
        machineId,
        chunkIndex,
        entries: [],
      });
    }
    return requestId;
  });
}

function readRequest(requestId: Id<'chatroom_repositoryLedgerRequests'>) {
  return t.run((ctx) => ctx.db.get('chatroom_repositoryLedgerRequests', requestId));
}

function readChunks(requestId: Id<'chatroom_repositoryLedgerRequests'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_repositoryLedgerChunks')
      .withIndex('by_request_chunk', (q) => q.eq('requestId', requestId))
      .collect()
  );
}

/** Count the seeded requests that still exist (the shared test database holds other tests' rows). */
function countExistingRequests(requestIds: Id<'chatroom_repositoryLedgerRequests'>[]) {
  return t.run(async (ctx) => {
    let count = 0;
    for (const requestId of requestIds) {
      if (await ctx.db.get('chatroom_repositoryLedgerRequests', requestId)) count++;
    }
    return count;
  });
}

/** Count chunk rows for the given machines. */
function countChunksForMachines(machineIds: string[]) {
  return t.run(async (ctx) => {
    let count = 0;
    for (const machineId of machineIds) {
      count += (
        await ctx.db
          .query('chatroom_repositoryLedgerChunks')
          .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
          .collect()
      ).length;
    }
    return count;
  });
}

function runCleanup() {
  return t.mutation(internal.repositoryLedger.cleanupExpiredLedgerRequests, {});
}

async function drainScheduler(): Promise<void> {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

afterEach(() => {
  vi.useRealTimers();
});

describe('repository ledger expiry cleanup', () => {
  test('deletes expired pending and terminal requests with their chunks and leaves unexpired rows untouched', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId } = await createTestSession('test-ledger-cleanup-mixed');
    const userId = await userIdFor(sessionId);

    const expiredPending = await seedRequest(userId, { expiresAt: START - 1 });
    const expiredCompleted = await seedRequest(userId, {
      status: 'completed',
      expiresAt: START - 1,
      chunkCount: 2,
    });
    const unexpired = await seedRequest(userId, {
      status: 'completed',
      expiresAt: START + 60_000,
      chunkCount: 1,
    });

    await runCleanup();
    await drainScheduler();

    expect(await readRequest(expiredPending)).toBeNull();
    expect(await readRequest(expiredCompleted)).toBeNull();
    expect(await readChunks(expiredCompleted)).toHaveLength(0);

    expect(await readRequest(unexpired)).not.toBeNull();
    expect(await readChunks(unexpired)).toHaveLength(1);
  });

  test('reschedules when a full batch of 100 expired requests was removed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId } = await createTestSession('test-ledger-cleanup-batch');
    const userId = await userIdFor(sessionId);

    const requestIds: Id<'chatroom_repositoryLedgerRequests'>[] = [];
    for (let i = 0; i < 101; i++) {
      requestIds.push(
        await seedRequest(userId, { machineId: `machine-ledger-batch-${i}`, expiresAt: START - 1 })
      );
    }

    await runCleanup();
    expect(await countExistingRequests(requestIds)).toBe(1);

    await drainScheduler();
    expect(await countExistingRequests(requestIds)).toBe(0);
  });

  test('stops at the chunk budget and reschedules the rest', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId } = await createTestSession('test-ledger-cleanup-chunk-budget');
    const userId = await userIdFor(sessionId);

    const machineIds = Array.from({ length: 3 }, (_, i) => `machine-ledger-budget-${i}`);
    const requestIds: Id<'chatroom_repositoryLedgerRequests'>[] = [];
    for (const machineId of machineIds) {
      requestIds.push(
        await seedRequest(userId, { machineId, expiresAt: START - 1, chunkCount: 10 })
      );
    }

    await runCleanup();
    expect(await countExistingRequests(requestIds)).toBe(1);
    expect(await countChunksForMachines(machineIds)).toBe(10);

    await drainScheduler();
    expect(await countExistingRequests(requestIds)).toBe(0);
    expect(await countChunksForMachines(machineIds)).toBe(0);
  });
});
