/**
 * Remote folder browse — Integration Tests
 *
 * Covers the `api.folderBrowse.*` session contract (open, navigate, close, get, getListing,
 * daemonPending, reportListing) and `internal.folderBrowse.cleanupExpiredFolderBrowseSessions`.
 * No machine command is ever enqueued.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

const START = 1_800_000_000_000;
const IDLE_TTL_MS = 10 * 60_000;

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

function listingReport(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'listing' as const,
    path: '/home/e2e',
    parentPath: '/home',
    entries: [{ name: 'projects' }, { name: 'scratch' }],
    dirCount: 2,
    fileCount: 3,
    hiddenCount: 1,
    complete: true,
    ...overrides,
  };
}

async function openSession(
  sessionId: SessionId,
  machineId: string,
  path?: string
): Promise<Id<'chatroom_folderBrowseSessions'>> {
  const { browseId } = await t.mutation(api.folderBrowse.open, { sessionId, machineId, path });
  return browseId;
}

function countSessionsFor(userId: Id<'users'>, machineId: string): Promise<number> {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('chatroom_folderBrowseSessions')
          .withIndex('by_user_machine', (q) => q.eq('userId', userId).eq('machineId', machineId))
          .collect()
      ).length
  );
}

function countListingsFor(browseId: Id<'chatroom_folderBrowseSessions'>): Promise<number> {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('chatroom_folderBrowseListings')
          .withIndex('by_browseId', (q) => q.eq('browseId', browseId))
          .collect()
      ).length
  );
}

async function userIdFor(sessionId: string): Promise<Id<'users'>> {
  return t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .first();
    if (!session?.userId) throw new Error(`No session for ${sessionId}`);
    return session.userId;
  });
}

async function drainScheduler(): Promise<void> {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

afterEach(() => {
  vi.useRealTimers();
});

describe('folder browse sessions', () => {
  // ── open ──────────────────────────────────────────────────────────────────

  test('open creates a pending session owned by the caller and enqueues no machine command', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-open-owner', 'machine-fb-open');

    const browseId = await openSession(sessionId, machineId);
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });

    expect(session).toMatchObject({
      machineId,
      state: 'pending',
      navSeq: 1,
      requestedPath: null,
      showHidden: false,
      filter: null,
      pendingSince: START,
      error: null,
      expiresAt: START + IDLE_TTL_MS,
    });
    expect(await getInboxCommandsForMachine(machineId)).toEqual([]);
  });

  test('open normalizes the start path', async () => {
    const { sessionId, machineId } = await setupMachine(
      'fb-open-normalize',
      'machine-fb-normalize'
    );

    const browseId = await openSession(sessionId, machineId, '//tmp///work/');
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });

    expect(session?.requestedPath).toBe('/tmp/work');
  });

  test('open rejects an invalid path', async () => {
    const { sessionId, machineId } = await setupMachine('fb-open-invalid', 'machine-fb-invalid');

    for (const path of ['tmp', '/tmp/../etc']) {
      await expect(
        t.mutation(api.folderBrowse.open, { sessionId, machineId, path })
      ).rejects.toMatchObject({ data: { code: 'FOLDER_BROWSE_INVALID_PATH' } });
    }
  });

  test('open requires ownership', async () => {
    const { machineId } = await setupMachine('fb-owner-a', 'machine-fb-owner-a');
    const { sessionId: otherSessionId } = await createTestSession('fb-other-user');

    await expect(
      t.mutation(api.folderBrowse.open, { sessionId: otherSessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });

    const { sessionId } = await createTestSession('fb-owner-unregistered');
    await expect(
      t.mutation(api.folderBrowse.open, { sessionId, machineId: 'machine-never-registered' })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_NOT_FOUND' } });
  });

  test('open evicts the oldest session beyond three per user and machine', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-evict-owner', 'machine-fb-evict');
    const userId = await userIdFor(sessionId);

    const browseA = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId: browseA,
      navSeq: 1,
      result: listingReport(),
    });
    vi.setSystemTime(START + 1_000);
    await openSession(sessionId, machineId);
    vi.setSystemTime(START + 2_000);
    await openSession(sessionId, machineId);
    vi.setSystemTime(START + 3_000);
    const browseD = await openSession(sessionId, machineId);

    expect(await t.query(api.folderBrowse.get, { sessionId, browseId: browseA })).toBeNull();
    expect(await countListingsFor(browseA)).toBe(0);
    expect(await countSessionsFor(userId, machineId)).toBe(3);
    expect(await t.query(api.folderBrowse.get, { sessionId, browseId: browseD })).not.toBeNull();
  });

  // ── navigate ──────────────────────────────────────────────────────────────

  test('navigate advances navSeq in place and refreshes the pending request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-nav-owner', 'machine-fb-nav');
    const userId = await userIdFor(sessionId);
    const browseId = await openSession(sessionId, machineId);

    const later = START + 5_000;
    vi.setSystemTime(later);
    const result = await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: '/home/e2e',
      showHidden: false,
    });
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });

    expect(result).toEqual({ navSeq: 2 });
    expect(session).toMatchObject({
      state: 'pending',
      navSeq: 2,
      requestedPath: '/home/e2e',
      pendingSince: later,
      expiresAt: later + IDLE_TTL_MS,
    });
    expect(await countSessionsFor(userId, machineId)).toBe(1);
  });

  test('an identical pending navigation is a no-op', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-nav-noop', 'machine-fb-noop');
    const browseId = await openSession(sessionId, machineId, '/tmp');
    const before = await t.query(api.folderBrowse.get, { sessionId, browseId });

    vi.setSystemTime(START + 5_000);
    const first = await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: '//tmp/',
      showHidden: false,
    });
    const second = await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: '//tmp/',
      showHidden: false,
    });
    const after = await t.query(api.folderBrowse.get, { sessionId, browseId });

    expect(first).toEqual({ navSeq: 1 });
    expect(second).toEqual({ navSeq: 1 });
    expect(after?.pendingSince).toBe(before?.pendingSince);
    expect(after?.expiresAt).toBe(before?.expiresAt);
  });

  test('navigate rejects an expired session', async () => {
    const { sessionId, machineId } = await setupMachine('fb-nav-expired', 'machine-fb-expired');
    const browseId = await openSession(sessionId, machineId);
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_folderBrowseSessions', browseId, { expiresAt: Date.now() - 1 });
    });

    await expect(
      t.mutation(api.folderBrowse.navigate, {
        sessionId,
        browseId,
        path: '/tmp',
        showHidden: false,
      })
    ).rejects.toMatchObject({ data: { code: 'FOLDER_BROWSE_EXPIRED' } });
  });

  test("navigate rejects another user's session", async () => {
    const { sessionId, machineId } = await setupMachine('fb-nav-owner-x', 'machine-fb-nav-x');
    const browseId = await openSession(sessionId, machineId);
    const { sessionId: otherSessionId } = await createTestSession('fb-nav-other');

    await expect(
      t.mutation(api.folderBrowse.navigate, {
        sessionId: otherSessionId,
        browseId,
        path: '/tmp',
        showHidden: false,
      })
    ).rejects.toMatchObject({ data: { code: 'FOLDER_BROWSE_NOT_FOUND' } });
  });

  test('navigate validates the path and the filter', async () => {
    const { sessionId, machineId } = await setupMachine('fb-nav-validate', 'machine-fb-validate');
    const browseId = await openSession(sessionId, machineId);

    await expect(
      t.mutation(api.folderBrowse.navigate, { sessionId, browseId, path: '/..', showHidden: false })
    ).rejects.toMatchObject({ data: { code: 'FOLDER_BROWSE_INVALID_PATH' } });

    await expect(
      t.mutation(api.folderBrowse.navigate, {
        sessionId,
        browseId,
        path: '/tmp',
        showHidden: false,
        filter: 'x'.repeat(129),
      })
    ).rejects.toMatchObject({ data: { code: 'FOLDER_BROWSE_INVALID_PATH' } });

    await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: null,
      showHidden: false,
      filter: '   ',
    });
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });
    expect(session?.filter).toBeNull();
  });

  // ── reportListing ─────────────────────────────────────────────────────────

  test('reportListing applies a matching listing and marks the session ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-report-ok', 'machine-fb-report');
    const browseId = await openSession(sessionId, machineId);

    const outcome = await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });
    const listing = await t.query(api.folderBrowse.getListing, { sessionId, browseId });

    expect(outcome).toEqual({ outcome: 'applied' });
    expect(session).toMatchObject({ state: 'ready', pendingSince: null, error: null });
    expect(listing).toEqual({
      seq: 1,
      requestedPath: null,
      path: '/home/e2e',
      parentPath: '/home',
      entries: [{ name: 'projects' }, { name: 'scratch' }],
      dirCount: 2,
      fileCount: 3,
      hiddenCount: 1,
      truncated: false,
      complete: true,
      selectable: true,
      listedAt: START,
    });
  });

  test('reportListing returns stale for an older navSeq and writes nothing', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-stale', 'machine-fb-stale');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: '/home/e2e',
      showHidden: false,
    });

    const outcome = await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });

    expect(outcome).toEqual({ outcome: 'stale' });
    expect(session).toMatchObject({ state: 'pending', navSeq: 2 });
    expect(await t.query(api.folderBrowse.getListing, { sessionId, browseId })).toBeNull();
  });

  test('reportListing returns duplicate once the session is ready', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-dup', 'machine-fb-dup');
    const browseId = await openSession(sessionId, machineId);
    const report = { sessionId, machineId, browseId, navSeq: 1, result: listingReport() };

    expect(await t.mutation(api.folderBrowse.reportListing, report)).toEqual({
      outcome: 'applied',
    });
    const firstListedAt = (await t.query(api.folderBrowse.getListing, { sessionId, browseId }))
      ?.listedAt;

    expect(await t.mutation(api.folderBrowse.reportListing, report)).toEqual({
      outcome: 'duplicate',
    });
    const listing = await t.query(api.folderBrowse.getListing, { sessionId, browseId });
    expect(listing?.listedAt).toBe(firstListedAt);
  });

  test('reportListing returns expired past the idle TTL', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-expired', 'machine-fb-exp');
    const browseId = await openSession(sessionId, machineId);
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_folderBrowseSessions', browseId, { expiresAt: Date.now() - 1 });
    });

    const outcome = await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });

    expect(outcome).toEqual({ outcome: 'expired' });
    expect(await t.query(api.folderBrowse.getListing, { sessionId, browseId })).toBeNull();
  });

  test('reportListing returns not_found for a deleted session', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-gone', 'machine-fb-gone');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.close, { sessionId, browseId });

    const outcome = await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });

    expect(outcome).toEqual({ outcome: 'not_found' });
  });

  test('reportListing rejects a machine mismatch and leaves the session pending', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-mismatch', 'machine-fb-mis-a');
    await registerMachineWithDaemon(sessionId, 'machine-fb-mis-b');
    const browseId = await openSession(sessionId, machineId);

    await expect(
      t.mutation(api.folderBrowse.reportListing, {
        sessionId,
        machineId: 'machine-fb-mis-b',
        browseId,
        navSeq: 1,
        result: listingReport(),
      })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });

    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });
    expect(session?.state).toBe('pending');
  });

  test('reportListing enforces the listing contract', async () => {
    const { sessionId, machineId } = await setupMachine(
      'fb-report-contract',
      'machine-fb-contract'
    );
    const browseId = await openSession(sessionId, machineId);

    const invalid: Record<string, unknown>[] = [
      // 501 entries
      {
        entries: Array.from({ length: 501 }, (_, i) => ({ name: `d${i}` })),
        dirCount: 501,
      },
      // name containing a slash
      { entries: [{ name: 'a/b' }], dirCount: 1 },
      // empty name
      { entries: [{ name: '' }], dirCount: 1 },
      // 256-character name
      { entries: [{ name: 'n'.repeat(256) }], dirCount: 1 },
      // 300 × 250 bytes = 75,000 name bytes, over the 65,536 cap
      {
        entries: Array.from({ length: 300 }, (_, i) => ({
          name: `${i}`.padEnd(250, 'x'),
        })),
        dirCount: 300,
      },
      // more entries than dirCount
      { entries: [{ name: 'a' }, { name: 'b' }], dirCount: 1 },
      // non-integer count
      { dirCount: 1.5 },
      // path not normalized
      { path: '/home//e2e' },
      // parentPath does not match the path
      { parentPath: '/wrong' },
      // root must have a null parent
      { path: '/', parentPath: '/' },
    ];

    for (const overrides of invalid) {
      await expect(
        t.mutation(api.folderBrowse.reportListing, {
          sessionId,
          machineId,
          browseId,
          navSeq: 1,
          result: listingReport(overrides),
        })
      ).rejects.toMatchObject({ data: { code: 'FOLDER_BROWSE_INVALID_LISTING' } });

      const session = await t.query(api.folderBrowse.get, { sessionId, browseId });
      expect(session?.state).toBe('pending');
    }
  });

  test('reportListing computes selectable from the working-dir rule', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-select', 'machine-fb-select');

    const cases = [
      { path: '/home/e2e', parentPath: '/home', selectable: true },
      { path: '/', parentPath: null, selectable: false },
      { path: '/home/My (old) #2', parentPath: '/home', selectable: false },
    ];
    for (const c of cases) {
      const browseId = await openSession(sessionId, machineId);
      await t.mutation(api.folderBrowse.reportListing, {
        sessionId,
        machineId,
        browseId,
        navSeq: 1,
        result: listingReport({ path: c.path, parentPath: c.parentPath }),
      });
      const listing = await t.query(api.folderBrowse.getListing, { sessionId, browseId });
      expect(listing?.selectable).toBe(c.selectable);
    }

    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport({ dirCount: 3 }),
    });
    const truncated = await t.query(api.folderBrowse.getListing, { sessionId, browseId });
    expect(truncated?.truncated).toBe(true);
  });

  test('reportListing applies an error and keeps the previous listing', async () => {
    const { sessionId, machineId } = await setupMachine('fb-report-error', 'machine-fb-error');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    const previous = await t.query(api.folderBrowse.getListing, { sessionId, browseId });
    await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: '/root',
      showHidden: false,
    });

    const outcome = await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 2,
      result: { kind: 'error', code: 'PERMISSION_DENIED', message: 'denied', path: '/root' },
    });
    const session = await t.query(api.folderBrowse.get, { sessionId, browseId });
    const listing = await t.query(api.folderBrowse.getListing, { sessionId, browseId });

    expect(outcome).toEqual({ outcome: 'applied' });
    expect(session).toMatchObject({
      state: 'error',
      pendingSince: null,
      error: { code: 'PERMISSION_DENIED', message: 'denied', path: '/root' },
    });
    expect(listing).toEqual(previous);

    // A long error message is capped at 500 characters.
    const second = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId: second,
      navSeq: 1,
      result: { kind: 'error', code: 'READ_FAILED', message: 'm'.repeat(600), path: '/x' },
    });
    const capped = await t.query(api.folderBrowse.get, { sessionId, browseId: second });
    expect(capped?.error?.message.length).toBe(500);
  });

  // ── get / getListing ──────────────────────────────────────────────────────

  test('get returns null for another user and for an unknown session', async () => {
    const { sessionId, machineId } = await setupMachine('fb-get-owner', 'machine-fb-get');
    const browseId = await openSession(sessionId, machineId);
    const { sessionId: otherSessionId } = await createTestSession('fb-get-other');

    expect(await t.query(api.folderBrowse.get, { sessionId: otherSessionId, browseId })).toBeNull();
    expect(
      await t.query(api.folderBrowse.get, { sessionId: 'no-such-session' as never, browseId })
    ).toBeNull();

    await t.mutation(api.folderBrowse.close, { sessionId, browseId });
    expect(await t.query(api.folderBrowse.get, { sessionId, browseId })).toBeNull();
  });

  test('getListing is not invalidated by navigate', async () => {
    const { sessionId, machineId } = await setupMachine('fb-getl-nav', 'machine-fb-getl');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    const before = await t.query(api.folderBrowse.getListing, { sessionId, browseId });

    await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: '/home/e2e/projects',
      showHidden: false,
    });
    const after = await t.query(api.folderBrowse.getListing, { sessionId, browseId });

    expect(after).toEqual(before);
    expect(after?.seq).toBe(1);
  });

  test('getListing returns null for another user and when there is no session', async () => {
    const { sessionId, machineId } = await setupMachine('fb-getl-owner', 'machine-fb-getl-o');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    const { sessionId: otherSessionId } = await createTestSession('fb-getl-other');

    expect(
      await t.query(api.folderBrowse.getListing, { sessionId: otherSessionId, browseId })
    ).toBeNull();
    expect(
      await t.query(api.folderBrowse.getListing, {
        sessionId: 'no-such-session' as never,
        browseId,
      })
    ).toBeNull();
  });

  // ── close ─────────────────────────────────────────────────────────────────

  test('close deletes the session and its listing and is idempotent', async () => {
    const { sessionId, machineId } = await setupMachine('fb-close-owner', 'machine-fb-close');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });

    expect(await t.mutation(api.folderBrowse.close, { sessionId, browseId })).toEqual({
      closed: true,
    });
    expect(await t.query(api.folderBrowse.get, { sessionId, browseId })).toBeNull();
    expect(await t.query(api.folderBrowse.getListing, { sessionId, browseId })).toBeNull();
    expect(await countListingsFor(browseId)).toBe(0);
    expect(await t.mutation(api.folderBrowse.close, { sessionId, browseId })).toEqual({
      closed: false,
    });
  });

  test("close does not delete another user's session", async () => {
    const { sessionId, machineId } = await setupMachine('fb-close-guard', 'machine-fb-guard');
    const browseId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    const { sessionId: otherSessionId } = await createTestSession('fb-close-other');

    expect(
      await t.mutation(api.folderBrowse.close, { sessionId: otherSessionId, browseId })
    ).toEqual({ closed: false });
    expect(await t.query(api.folderBrowse.get, { sessionId, browseId })).not.toBeNull();
    expect(await t.query(api.folderBrowse.getListing, { sessionId, browseId })).not.toBeNull();
  });

  // ── daemonPending ─────────────────────────────────────────────────────────

  test('daemonPending returns the pending navigation for the owning daemon only', async () => {
    const { sessionId, machineId } = await setupMachine('fb-pending-owner', 'machine-fb-pending');
    const browseId = await openSession(sessionId, machineId);

    expect(await t.query(api.folderBrowse.daemonPending, { sessionId, machineId })).toEqual([
      { browseId, navSeq: 1, path: null, showHidden: false, filter: null },
    ]);

    const { sessionId: otherSessionId } = await createTestSession('fb-pending-other');
    expect(
      await t.query(api.folderBrowse.daemonPending, {
        sessionId: otherSessionId,
        machineId,
      })
    ).toEqual([]);
    expect(
      await t.query(api.folderBrowse.daemonPending, {
        sessionId: 'no-such-session' as never,
        machineId,
      })
    ).toEqual([]);
    expect(
      await t.query(api.folderBrowse.daemonPending, {
        sessionId,
        machineId: 'machine-fb-does-not-exist',
      })
    ).toEqual([]);

    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    expect(await t.query(api.folderBrowse.daemonPending, { sessionId, machineId })).toEqual([]);

    await t.mutation(api.folderBrowse.navigate, {
      sessionId,
      browseId,
      path: null,
      showHidden: false,
      filter: 'proj',
    });
    const pending = await t.query(api.folderBrowse.daemonPending, { sessionId, machineId });
    expect(pending).toEqual([
      { browseId, navSeq: 2, path: null, showHidden: false, filter: 'proj' },
    ]);
  });

  test('daemonPending only returns pending sessions', async () => {
    const { sessionId, machineId } = await setupMachine('fb-pending-two', 'machine-fb-two');
    const first = await openSession(sessionId, machineId);
    const second = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId: first,
      navSeq: 1,
      result: listingReport(),
    });

    const pending = await t.query(api.folderBrowse.daemonPending, { sessionId, machineId });
    expect(pending.map((row) => row.browseId)).toEqual([second]);
  });

  // ── end-to-end ────────────────────────────────────────────────────────────

  test('end-to-end: open, daemonPending, reportListing, then get and getListing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-e2e-owner', 'machine-fb-e2e');

    const browseId = await openSession(sessionId, machineId);
    expect(await getInboxCommandsForMachine(machineId)).toEqual([]);

    const pendingBefore = await t.query(api.folderBrowse.daemonPending, { sessionId, machineId });
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]).toMatchObject({ path: null, navSeq: 1 });

    const outcome = await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId,
      navSeq: 1,
      result: listingReport(),
    });
    expect(outcome).toEqual({ outcome: 'applied' });

    const ready = await t.query(api.folderBrowse.get, { sessionId, browseId });
    const listed = await t.query(api.folderBrowse.getListing, { sessionId, browseId });
    expect(ready?.state).toBe('ready');
    expect(listed?.path).toBe('/home/e2e');
    expect(listed?.entries[0].name).toBe('projects');

    expect(
      await t.mutation(api.folderBrowse.navigate, {
        sessionId,
        browseId,
        path: '/home/e2e/projects',
        showHidden: false,
      })
    ).toEqual({ navSeq: 2 });

    const pendingAfter = await t.query(api.folderBrowse.daemonPending, { sessionId, machineId });
    expect(pendingAfter).toHaveLength(1);
    expect(pendingAfter[0]).toMatchObject({ path: '/home/e2e/projects', navSeq: 2 });

    // The listing content is unchanged while the new navigation is pending.
    expect(await t.query(api.folderBrowse.getListing, { sessionId, browseId })).toEqual(listed);
  });
  // ── cleanup ───────────────────────────────────────────────────────────────

  test('cleanup deletes expired sessions and their listings and keeps live ones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-cleanup-owner', 'machine-fb-cleanup');
    const userId = await userIdFor(sessionId);

    const expiredId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_folderBrowseSessions', {
        userId,
        machineId,
        state: 'ready',
        navSeq: 1,
        requestedPath: '/old',
        showHidden: false,
        createdAt: START - 60_000,
        expiresAt: START - 1,
      });
      await ctx.db.insert('chatroom_folderBrowseListings', {
        browseId: id,
        userId,
        machineId,
        seq: 1,
        requestedPath: '/old',
        path: '/old',
        parentPath: '/',
        entries: [],
        dirCount: 0,
        fileCount: 0,
        hiddenCount: 0,
        truncated: false,
        complete: true,
        selectable: true,
        listedAt: START - 60_000,
      });
      return id;
    });
    const liveId = await openSession(sessionId, machineId);
    await t.mutation(api.folderBrowse.reportListing, {
      sessionId,
      machineId,
      browseId: liveId,
      navSeq: 1,
      result: listingReport(),
    });

    await t.mutation(internal.folderBrowse.cleanupExpiredFolderBrowseSessions, {});

    expect(await countSessionsFor(userId, machineId)).toBe(1);
    expect(await countListingsFor(expiredId)).toBe(0);
    expect(await countListingsFor(liveId)).toBe(1);
    expect(await t.query(api.folderBrowse.get, { sessionId, browseId: liveId })).not.toBeNull();
  });

  test('cleanup reschedules on a full batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const { sessionId, machineId } = await setupMachine('fb-cleanup-batch', 'machine-fb-batch');
    const userId = await userIdFor(sessionId);

    const withListing: Id<'chatroom_folderBrowseSessions'>[] = await t.run(async (ctx) => {
      const ids: Id<'chatroom_folderBrowseSessions'>[] = [];
      for (let i = 0; i < 101; i++) {
        const id = await ctx.db.insert('chatroom_folderBrowseSessions', {
          userId,
          machineId,
          state: 'pending',
          navSeq: 1,
          requestedPath: null,
          showHidden: false,
          createdAt: START - 60_000,
          expiresAt: START - 1,
        });
        ids.push(id);
        if (i < 3) {
          await ctx.db.insert('chatroom_folderBrowseListings', {
            browseId: id,
            userId,
            machineId,
            seq: 1,
            requestedPath: null,
            path: '/',
            parentPath: null,
            entries: [],
            dirCount: 0,
            fileCount: 0,
            hiddenCount: 0,
            truncated: false,
            complete: true,
            selectable: false,
            listedAt: START - 60_000,
          });
        }
      }
      return ids.slice(0, 3);
    });

    await t.mutation(internal.folderBrowse.cleanupExpiredFolderBrowseSessions, {});
    expect(await countSessionsFor(userId, machineId)).toBe(1);

    await drainScheduler();
    expect(await countSessionsFor(userId, machineId)).toBe(0);
    for (const browseId of withListing) {
      expect(await countListingsFor(browseId)).toBe(0);
    }
  });
});
