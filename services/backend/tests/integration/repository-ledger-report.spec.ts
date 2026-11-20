/**
 * Repository ledger reporting — Integration Tests
 *
 * Covers `api.repositoryLedger.reportResult`: ownership, status transitions,
 * expiry, chunking, truncation, path normalization, and the atomic row + chunk
 * write.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];
type RequestId = Id<'chatroom_repositoryLedgerRequests'>;

/** Expected pending-request lifetime; mirrors the daemon routine command TTL. */
const PENDING_TTL_MS = 5 * 60_000;
/** Expected terminal snapshot lifetime. */
const COMPLETED_TTL_MS = 10 * 60_000;
const START = 1_800_000_000_000;

type LedgerEntryArg = {
  path: string;
  name: string;
  root: string;
  branch?: string;
  remoteUrl?: string;
  discoveredAt: number;
};

type LedgerRootArg = {
  path: string;
  status: 'ok' | 'missing' | 'unreadable';
  repositoryCount: number;
};

function entry(i: number, overrides: Partial<LedgerEntryArg> = {}): LedgerEntryArg {
  return {
    path: `/work/repo-${i}`,
    name: `repo-${i}`,
    root: '/work',
    discoveredAt: START,
    ...overrides,
  };
}

function entries(count: number): LedgerEntryArg[] {
  return Array.from({ length: count }, (_, i) => entry(i));
}

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

async function requestSnapshot(sessionId: SessionId, machineId: string) {
  return t.mutation(api.repositoryLedger.request, { sessionId, machineId, rescan: false });
}

function readRequest(requestId: RequestId) {
  return t.run((ctx) => ctx.db.get('chatroom_repositoryLedgerRequests', requestId));
}

function readChunks(requestId: RequestId) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_repositoryLedgerChunks')
      .withIndex('by_request_chunk', (q) => q.eq('requestId', requestId))
      .collect()
  );
}

function reportCompleted(
  sessionId: SessionId,
  machineId: string,
  requestId: RequestId,
  args: {
    entries?: LedgerEntryArg[];
    truncated?: boolean;
    roots?: LedgerRootArg[];
    ledgerGeneratedAt?: number;
  } = {}
) {
  return t.mutation(api.repositoryLedger.reportResult, {
    sessionId,
    machineId,
    requestId,
    status: 'completed' as const,
    entries: args.entries ?? [],
    truncated: args.truncated,
    roots: args.roots,
    ledgerGeneratedAt: args.ledgerGeneratedAt,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('repository ledger reports', () => {
  test('completed report stores 250 entries as chunks of 100, 100, 50 and marks the row completed in the same write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-250',
      'machine-ledger-report-250'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const result = await reportCompleted(sessionId, machineId, requestId, {
      entries: entries(250),
    });
    expect(result).toEqual({ ok: true });

    const chunks = await readChunks(requestId);
    expect(chunks.map((chunk) => chunk.entries.length)).toEqual([100, 100, 50]);

    const row = await readRequest(requestId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('completed');
    expect(row!.repositoryCount).toBe(250);
    expect(row!.invalidPathCount).toBe(0);
    expect(row!.truncated).toBe(false);
    expect(row!.completedAt).toBe(START);
    expect(row!.expiresAt).toBe(START + COMPLETED_TTL_MS);
  });

  test('1005 entries store the first 1000 in 10 chunks and set truncated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-over-cap',
      'machine-ledger-report-over-cap'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, { entries: entries(1005) });

    const chunks = await readChunks(requestId);
    expect(chunks).toHaveLength(10);
    expect(chunks.flatMap((chunk) => chunk.entries)).toHaveLength(1000);

    const row = await readRequest(requestId);
    expect(row!.repositoryCount).toBe(1000);
    expect(row!.truncated).toBe(true);

    const stored = chunks.flatMap((chunk) => chunk.entries);
    expect(stored[0]!.path).toBe('/work/repo-0');
    expect(stored[stored.length - 1]!.path).toBe('/work/repo-999');
  });

  test('a scanner-truncated report with few entries sets truncated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-scanner-truncated',
      'machine-ledger-report-scanner-truncated'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, {
      entries: entries(3),
      truncated: true,
    });

    const row = await readRequest(requestId);
    expect(row!.truncated).toBe(true);
    expect(row!.repositoryCount).toBe(3);
  });

  test('invalid paths are counted and not stored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-invalid-paths',
      'machine-ledger-report-invalid-paths'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, {
      entries: [
        entry(0, { path: '/work/repo-0' }),
        entry(1, { path: '/work/repo-1' }),
        entry(2, { path: 'relative/repo' }),
        entry(3, { path: '/' }),
        entry(4, { path: '/work/' + 'a'.repeat(1024) }),
      ],
    });

    const row = await readRequest(requestId);
    expect(row!.invalidPathCount).toBe(3);
    expect(row!.repositoryCount).toBe(2);

    const stored = (await readChunks(requestId)).flatMap((chunk) => chunk.entries);
    expect(stored.map((storedEntry) => storedEntry.path)).toEqual(['/work/repo-0', '/work/repo-1']);
  });

  test('a second completed report returns duplicate and stores nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-duplicate',
      'machine-ledger-report-duplicate'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, { entries: entries(5) });

    const chunksBefore = await readChunks(requestId);
    const rowBefore = await readRequest(requestId);

    expect(await reportCompleted(sessionId, machineId, requestId, { entries: entries(7) })).toEqual(
      { ok: true, duplicate: true }
    );

    const chunksAfter = await readChunks(requestId);
    expect(chunksAfter.map((chunk) => chunk._id)).toEqual(chunksBefore.map((chunk) => chunk._id));
    expect(await readRequest(requestId)).toEqual(rowBefore);

    expect(
      await t.mutation(api.repositoryLedger.reportResult, {
        sessionId,
        machineId,
        requestId,
        status: 'failed' as const,
        errorMessage: 'too late',
      })
    ).toEqual({ ok: true, duplicate: true });
  });

  test('failed report marks the request failed with errorMessage, stores no chunks, and sets expiresAt = completedAt + 10 min', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-failed',
      'machine-ledger-report-failed'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const result = await t.mutation(api.repositoryLedger.reportResult, {
      sessionId,
      machineId,
      requestId,
      status: 'failed' as const,
      errorMessage: 'scan failed',
    });
    expect(result).toEqual({ ok: true });

    expect(await readChunks(requestId)).toHaveLength(0);

    const row = await readRequest(requestId);
    expect(row!.status).toBe('failed');
    expect(row!.errorMessage).toBe('scan failed');
    expect(row!.completedAt).toBe(START);
    expect(row!.expiresAt).toBe(START + COMPLETED_TTL_MS);
    expect(row!.expiresAt).toBe(row!.completedAt! + COMPLETED_TTL_MS);
  });

  test('report after expiresAt returns ignored and stores nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-expired',
      'machine-ledger-report-expired'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    vi.setSystemTime(START + PENDING_TTL_MS);

    expect(await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) })).toEqual(
      { ok: true, ignored: true }
    );

    const row = await readRequest(requestId);
    expect(row!.status).toBe('pending');
    expect(await readChunks(requestId)).toHaveLength(0);
  });

  test('report after discard returns ignored and stores nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-discarded',
      'machine-ledger-report-discarded'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await t.mutation(api.repositoryLedger.discard, { sessionId, requestId });

    expect(await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) })).toEqual(
      { ok: true, ignored: true }
    );

    expect(await readRequest(requestId)).toBeNull();
    expect(await readChunks(requestId)).toHaveLength(0);
  });

  test('report for a request of another machine throws REPOSITORY_LEDGER_REQUEST_NOT_FOUND and stores nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-cross-machine',
      'machine-ledger-report-cross-machine'
    );
    const otherMachineId = 'machine-ledger-report-cross-machine-b';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId: otherMachineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    });
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await expect(
      reportCompleted(sessionId, otherMachineId, requestId, { entries: entries(2) })
    ).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.REPOSITORY_LEDGER_REQUEST_NOT_FOUND },
    });

    expect(await readChunks(requestId)).toHaveLength(0);
    expect((await readRequest(requestId))!.status).toBe('pending');
  });

  test('non-owner report is rejected and stores nothing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-owner',
      'machine-ledger-report-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-ledger-report-other');
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await expect(
      reportCompleted(otherSessionId, machineId, requestId, { entries: entries(2) })
    ).rejects.toMatchObject({ data: { code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE } });

    expect(await readChunks(requestId)).toHaveLength(0);
    expect((await readRequest(requestId))!.status).toBe('pending');
  });

  test('chunk documents stay under 1 MiB at worst-case entry sizes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-chunk-size',
      'machine-ledger-report-chunk-size'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const worstCase = Array.from({ length: 1000 }, (_, i) =>
      entry(i, {
        path: '/' + String(i).padStart(4, '0') + 'p'.repeat(1019),
        root: '/' + 'r'.repeat(1023),
        name: 'n'.repeat(255),
        branch: 'b'.repeat(255),
        remoteUrl: 'https://example.com/' + 'u'.repeat(2024),
      })
    );

    await reportCompleted(sessionId, machineId, requestId, { entries: worstCase });

    const row = await readRequest(requestId);
    expect(row!.repositoryCount).toBe(1000);

    const chunks = await readChunks(requestId);
    expect(chunks).toHaveLength(10);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(JSON.stringify(chunk)).length).toBeLessThan(1_048_576);
    }
  });

  test('an over-long path is dropped and counted, never truncated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-long-path',
      'machine-ledger-report-long-path'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, {
      entries: [entry(1), entry(0, { path: '/' + 'a'.repeat(1024), root: '/work' }), entry(2)],
    });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.repositoryCount).toBe(2);
    expect(row!.invalidPathCount).toBe(1);

    const stored = (await readChunks(requestId)).flatMap((chunk) => chunk.entries);
    expect(stored.map((storedEntry) => storedEntry.path)).toEqual(['/work/repo-1', '/work/repo-2']);
  });

  test('over-long name, branch, and remoteUrl each drop their entry and are counted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-long-fields',
      'machine-ledger-report-long-fields'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, {
      entries: [
        entry(1),
        entry(0, { name: 'n'.repeat(257) }),
        entry(2, { branch: 'b'.repeat(257) }),
        entry(3, { remoteUrl: 'u'.repeat(2049) }),
      ],
    });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.invalidPathCount).toBe(3);
    expect(row!.repositoryCount).toBe(1);

    const stored = (await readChunks(requestId)).flatMap((chunk) => chunk.entries);
    expect(stored.map((storedEntry) => storedEntry.path)).toEqual(['/work/repo-1']);
  });

  test('boundary-length field values are kept unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-boundary',
      'machine-ledger-report-boundary'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const atBoundary = entry(1, {
      path: '/' + 'b'.repeat(1023),
      name: 'n'.repeat(256),
      branch: 'b'.repeat(256),
      remoteUrl: 'u'.repeat(2048),
    });

    await reportCompleted(sessionId, machineId, requestId, { entries: [atBoundary] });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.invalidPathCount).toBe(0);
    expect(row!.repositoryCount).toBe(1);

    const stored = (await readChunks(requestId)).flatMap((chunk) => chunk.entries);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.path).toBe(atBoundary.path);
    expect(stored[0]!.name).toBe(atBoundary.name);
    expect(stored[0]!.branch).toBe(atBoundary.branch);
    expect(stored[0]!.remoteUrl).toBe(atBoundary.remoteUrl);
  });

  test('a report with one over-long entry still completes atomically with the other entries stored', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-atomic-caps',
      'machine-ledger-report-atomic-caps'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const result = await reportCompleted(sessionId, machineId, requestId, {
      entries: [entry(0), entry(1, { branch: 'b'.repeat(257) }), entry(2)],
    });
    expect(result).toEqual({ ok: true });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.completedAt).toBe(START);
    expect(row!.invalidPathCount).toBe(1);
    expect(row!.repositoryCount).toBe(2);

    const stored = (await readChunks(requestId)).flatMap((chunk) => chunk.entries);
    expect(stored.map((storedEntry) => storedEntry.path)).toEqual(['/work/repo-0', '/work/repo-2']);
  });

  test('roots over 20 are truncated to the first 20 and the report still completes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-roots-cap',
      'machine-ledger-report-roots-cap'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const roots: LedgerRootArg[] = Array.from({ length: 21 }, (_, i) => ({
      path: `/r-${i}`,
      status: 'ok',
      repositoryCount: 0,
    }));

    const result = await reportCompleted(sessionId, machineId, requestId, { roots });
    expect(result).toEqual({ ok: true });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.roots).toHaveLength(20);
    expect(row!.roots![0]!.path).toBe('/r-0');
    expect(row!.roots!.map((root) => root.path)).not.toContain('/r-20');
  });

  test('a trailing-slash duplicate is stored once and the first entry wins', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-dedupe',
      'machine-ledger-report-dedupe'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    await reportCompleted(sessionId, machineId, requestId, {
      entries: [
        entry(1, { path: '/work/repo-1', name: 'first' }),
        entry(1, { path: '/work/repo-1/', name: 'second' }),
      ],
    });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.repositoryCount).toBe(1);
    expect(row!.invalidPathCount).toBe(0);

    const stored = (await readChunks(requestId)).flatMap((chunk) => chunk.entries);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe('first');
    expect(stored[0]!.path).toBe('/work/repo-1');
  });

  test('the stored row keeps the reported roots and ledgerGeneratedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-report-stored-row',
      'machine-ledger-report-stored-row'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    const roots: LedgerRootArg[] = [{ path: '/work', status: 'ok', repositoryCount: 1 }];

    await reportCompleted(sessionId, machineId, requestId, {
      entries: [entry(1)],
      roots,
      ledgerGeneratedAt: START + 5_000,
    });

    const row = await readRequest(requestId);
    expect(row!.status).toBe('completed');
    expect(row!.roots).toEqual(roots);
    expect(row!.ledgerGeneratedAt).toBe(START + 5_000);
  });
});
