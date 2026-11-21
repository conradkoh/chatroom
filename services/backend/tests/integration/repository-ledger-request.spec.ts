/**
 * Repository ledger request lifecycle — Integration Tests
 *
 * Covers `api.repositoryLedger.request`, `get` and `discard`: offline gating,
 * request reuse, command enqueue, expiry, owner scoping and chunk cleanup.
 * Reporting lives in repository-ledger-report.spec.ts and expiry cleanup in
 * repository-ledger-cleanup.spec.ts. Listing lands in a later slice.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];

/** Expected pending-request lifetime; mirrors the daemon routine command TTL. */
const PENDING_TTL_MS = 5 * 60_000;

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

/** Register a machine without marking its daemon online. */
async function setupOfflineMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
    availableModels: { opencode: [] },
  });
  return { sessionId, machineId };
}

async function requestSnapshot(sessionId: SessionId, machineId: string, rescan: boolean) {
  return t.mutation(api.repositoryLedger.request, { sessionId, machineId, rescan });
}

function getRequest(sessionId: SessionId, requestId: Id<'chatroom_repositoryLedgerRequests'>) {
  return t.query(api.repositoryLedger.get, { sessionId, requestId });
}

function readRequestRows(machineId: string) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_repositoryLedgerRequests')
      .withIndex('by_machineId_createdAt', (q) => q.eq('machineId', machineId))
      .collect()
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('repository ledger requests', () => {
  test('request while the machine is offline throws MACHINE_OFFLINE and writes no row or command', async () => {
    const { sessionId, machineId } = await setupOfflineMachine(
      'test-ledger-offline',
      'machine-ledger-offline'
    );

    await expect(requestSnapshot(sessionId, machineId, false)).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.MACHINE_OFFLINE },
    });

    expect(await readRequestRows(machineId)).toHaveLength(0);
    expect(
      await getInboxCommandsForMachine(machineId, 'daemon.reportRepositoryLedger')
    ).toHaveLength(0);
  });

  test('request on an online machine inserts a pending row with expiresAt = createdAt + 5 min and enqueues exactly one command', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-create',
      'machine-ledger-create'
    );

    const result = await requestSnapshot(sessionId, machineId, false);
    expect(result.reused).toBe(false);

    const rows = await readRequestRows(machineId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row._id).toBe(result.requestId);
    expect(row.status).toBe('pending');
    expect(row.rescan).toBe(false);
    expect(row.expiresAt).toBe(row.createdAt + PENDING_TTL_MS);
    expect(row.expiresAt - row.createdAt).toBe(PENDING_TTL_MS);

    const inbox = await getInboxCommandsForMachine(machineId, 'daemon.reportRepositoryLedger');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.command).toEqual({
      type: 'daemon.reportRepositoryLedger',
      requestId: result.requestId,
      rescan: false,
    });
  });

  test('a second request that a pending request satisfies returns the same requestId with reused: true and enqueues nothing', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-reuse',
      'machine-ledger-reuse'
    );

    const first = await requestSnapshot(sessionId, machineId, false);
    const second = await requestSnapshot(sessionId, machineId, false);

    expect(second).toEqual({ requestId: first.requestId, reused: true });
    expect(
      await getInboxCommandsForMachine(machineId, 'daemon.reportRepositoryLedger')
    ).toHaveLength(1);
  });

  test('a pending rescan:false request does not satisfy a rescan:true ask: a new request and a second command', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-rescan-upgrade',
      'machine-ledger-rescan-upgrade'
    );

    const first = await requestSnapshot(sessionId, machineId, false);
    const second = await requestSnapshot(sessionId, machineId, true);

    expect(second.reused).toBe(false);
    expect(second.requestId).not.toBe(first.requestId);
    expect(
      await getInboxCommandsForMachine(machineId, 'daemon.reportRepositoryLedger')
    ).toHaveLength(2);
  });

  test('a pending rescan:true request satisfies a rescan:false ask', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-rescan-downgrade',
      'machine-ledger-rescan-downgrade'
    );

    const first = await requestSnapshot(sessionId, machineId, true);
    const second = await requestSnapshot(sessionId, machineId, false);

    expect(second).toEqual({ requestId: first.requestId, reused: true });
    expect(
      await getInboxCommandsForMachine(machineId, 'daemon.reportRepositoryLedger')
    ).toHaveLength(1);
  });

  test('an expired pending request is not reused', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-expired',
      'machine-ledger-expired'
    );
    const start = 1_800_000_000_000;

    vi.useFakeTimers();
    vi.setSystemTime(start);
    const first = await requestSnapshot(sessionId, machineId, false);

    vi.setSystemTime(start + PENDING_TTL_MS + 1);
    const second = await requestSnapshot(sessionId, machineId, false);

    expect(second.reused).toBe(false);
    expect(second.requestId).not.toBe(first.requestId);
    expect(
      await getInboxCommandsForMachine(machineId, 'daemon.reportRepositoryLedger')
    ).toHaveLength(2);
  });

  test('get returns the row to its owner and null to another user', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-get-owner',
      'machine-ledger-get-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-ledger-get-other');

    const { requestId } = await requestSnapshot(sessionId, machineId, false);

    const owner = await getRequest(sessionId, requestId);
    expect(owner).not.toBeNull();
    expect(owner!._id).toBe(requestId);
    expect(owner!.machineId).toBe(machineId);

    expect(await getRequest(otherSessionId, requestId)).toBeNull();
  });

  test('discard deletes the request and its chunks for the owner and is a no-op for another user', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-discard-owner',
      'machine-ledger-discard-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-ledger-discard-other');

    const { requestId } = await requestSnapshot(sessionId, machineId, false);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_repositoryLedgerChunks', {
        requestId,
        machineId,
        chunkIndex: 0,
        entries: [],
      });
    });

    expect(
      await t.mutation(api.repositoryLedger.discard, { sessionId: otherSessionId, requestId })
    ).toEqual({ ok: true });
    expect(await getRequest(sessionId, requestId)).not.toBeNull();

    expect(await t.mutation(api.repositoryLedger.discard, { sessionId, requestId })).toEqual({
      ok: true,
    });
    expect(await getRequest(sessionId, requestId)).toBeNull();

    const chunks = await t.run((ctx) =>
      ctx.db
        .query('chatroom_repositoryLedgerChunks')
        .withIndex('by_request_chunk', (q) => q.eq('requestId', requestId))
        .collect()
    );
    expect(chunks).toHaveLength(0);

    expect(await t.mutation(api.repositoryLedger.discard, { sessionId, requestId })).toEqual({
      ok: true,
    });
  });
});
