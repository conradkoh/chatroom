/**
 * Repository ledger listing — Integration Tests
 *
 * Covers `api.repositoryLedger.listEntries`: chunk-based pagination, the numItems clamp,
 * entry-to-list-row mapping, chatroom flags (create / archive / remove), ownership, expiry,
 * discard and pending requests.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createSoloTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];
type RequestId = Id<'chatroom_repositoryLedgerRequests'>;

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

async function setupMachineAndChatroom(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createSoloTeamChatroom(sessionId);
  return { sessionId, chatroomId, machineId };
}

async function requestSnapshot(sessionId: SessionId, machineId: string) {
  return t.mutation(api.repositoryLedger.request, { sessionId, machineId, rescan: false });
}

function reportCompleted(
  sessionId: SessionId,
  machineId: string,
  requestId: RequestId,
  args: { entries?: LedgerEntryArg[] } = {}
) {
  return t.mutation(api.repositoryLedger.reportResult, {
    sessionId,
    machineId,
    requestId,
    status: 'completed' as const,
    entries: args.entries ?? [],
  });
}

function registerWorkspace(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
) {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

function listPage(
  sessionId: SessionId,
  requestId: RequestId,
  numItems: number,
  cursor: string | null = null
) {
  return t.query(api.repositoryLedger.listEntries, {
    sessionId,
    requestId,
    paginationOpts: { numItems, cursor },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('repository ledger listEntries', () => {
  test('a completed snapshot with no entries returns an empty done page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-empty',
      'machine-ledger-list-empty'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: [] });

    expect(await listPage(sessionId, requestId, 3)).toMatchObject({ page: [], isDone: true });
  });

  test('one entry is mapped to a list row without a chatroom', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-one',
      'machine-ledger-list-one'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, {
      entries: [entry(0, { branch: 'main', remoteUrl: 'https://example.com/repo.git' })],
    });

    const result = await listPage(sessionId, requestId, 3);

    expect(result.isDone).toBe(true);
    expect(result.page).toHaveLength(1);
    const row = result.page[0]!;
    expect(row).toEqual({
      path: '/work/repo-0',
      name: 'repo-0',
      root: '/work',
      branch: 'main',
      remoteUrl: 'https://example.com/repo.git',
      discoveredAt: START,
      hasChatroom: false,
    });
    expect(row).not.toHaveProperty('chatroomId');
  });

  test('exactly 100 entries fit in one chunk and one page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-100',
      'machine-ledger-list-100'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(100) });

    const result = await listPage(sessionId, requestId, 3);

    expect(result.page).toHaveLength(100);
    expect(result.isDone).toBe(true);
  });

  test('350 entries paginate in chunk order with no gaps or duplicates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-350',
      'machine-ledger-list-350'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(350) });

    const first = await listPage(sessionId, requestId, 3);
    expect(first.page).toHaveLength(300);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor).not.toBe('');

    const second = await listPage(sessionId, requestId, 3, first.continueCursor);
    expect(second.page).toHaveLength(50);
    expect(second.isDone).toBe(true);

    const paths = [...first.page, ...second.page].map((row) => row.path);
    expect(paths).toEqual(Array.from({ length: 350 }, (_, i) => `/work/repo-${i}`));
    expect(new Set(paths).size).toBe(350);
  });

  test('numItems is clamped to LEDGER_MAX_CHUNKS so 1000 entries come back in one call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-clamp',
      'machine-ledger-list-clamp'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(1005) });

    const result = await listPage(sessionId, requestId, 50);

    expect(result.page).toHaveLength(1000);
    expect(result.isDone).toBe(true);
    expect(result.page[0]!.path).toBe('/work/repo-0');
    expect(result.page[result.page.length - 1]!.path).toBe('/work/repo-999');
  });

  test('an active chatroom workspace flips only its own row to hasChatroom', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, chatroomId, machineId } = await setupMachineAndChatroom(
      'test-ledger-list-flip-create',
      'machine-ledger-list-flip-create'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) });

    const before = await listPage(sessionId, requestId, 3);
    expect(before.page.map((row) => row.hasChatroom)).toEqual([false, false]);

    await registerWorkspace(sessionId, chatroomId, machineId, '/work/repo-0');

    const after = await listPage(sessionId, requestId, 3);
    expect(after.page.map((row) => row.hasChatroom)).toEqual([true, false]);
    expect(after.page[0]!.chatroomId).toBe(chatroomId);
    expect(after.page[1]).not.toHaveProperty('chatroomId');
  });

  test('archiving the chatroom clears the flag', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, chatroomId, machineId } = await setupMachineAndChatroom(
      'test-ledger-list-flip-archive',
      'machine-ledger-list-flip-archive'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) });
    await registerWorkspace(sessionId, chatroomId, machineId, '/work/repo-0');

    expect((await listPage(sessionId, requestId, 3)).page[0]!.hasChatroom).toBe(true);

    await t.mutation(api.chatrooms.archive, { sessionId, chatroomId });

    const after = await listPage(sessionId, requestId, 3);
    expect(after.page[0]!.hasChatroom).toBe(false);
    expect(after.page[0]).not.toHaveProperty('chatroomId');
  });

  test('removing the workspace clears the flag', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, chatroomId, machineId } = await setupMachineAndChatroom(
      'test-ledger-list-flip-remove',
      'machine-ledger-list-flip-remove'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) });
    const workspaceId = await registerWorkspace(sessionId, chatroomId, machineId, '/work/repo-0');

    expect((await listPage(sessionId, requestId, 3)).page[0]!.hasChatroom).toBe(true);

    await t.mutation(api.workspaces.removeWorkspace, { sessionId, workspaceId });

    const after = await listPage(sessionId, requestId, 3);
    expect(after.page[0]!.hasChatroom).toBe(false);
    expect(after.page[0]).not.toHaveProperty('chatroomId');
  });

  test('a non-owner gets an empty page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-owner',
      'machine-ledger-list-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-ledger-list-other');
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) });

    expect(await listPage(otherSessionId, requestId, 3)).toMatchObject({ page: [], isDone: true });
  });

  test('a discarded request returns an empty page without throwing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-discarded',
      'machine-ledger-list-discarded'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(2) });
    await t.mutation(api.repositoryLedger.discard, { sessionId, requestId });

    expect(await listPage(sessionId, requestId, 3)).toMatchObject({ page: [], isDone: true });
  });

  test('an expired request returns an empty page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-expired',
      'machine-ledger-list-expired'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);
    await reportCompleted(sessionId, machineId, requestId, { entries: entries(1) });

    expect((await listPage(sessionId, requestId, 3)).page).toHaveLength(1);

    vi.setSystemTime(START + COMPLETED_TTL_MS);

    expect(await listPage(sessionId, requestId, 3)).toMatchObject({ page: [], isDone: true });
  });

  test('a pending request without a report returns an empty page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine(
      'test-ledger-list-pending',
      'machine-ledger-list-pending'
    );
    const { requestId } = await requestSnapshot(sessionId, machineId);

    expect(await listPage(sessionId, requestId, 3)).toMatchObject({ page: [], isDone: true });
  });
});
