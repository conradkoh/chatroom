/**
 * Machine project roots — Integration Tests
 *
 * Covers the owner-facing contract end to end through the public Convex API:
 * normalization, duplicate/nesting/limit rules, parent collapse, offline behaviour,
 * ownership, the coalesced `daemon.syncProjectRoots` inbox nudge, and purge on
 * machine deletion.
 */

import { describe, expect, test, vi } from 'vitest';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];

/** Unique user + online machine pair for one case. */
async function setup(key: string) {
  const { sessionId } = await createTestSession(`project-roots-${key}`);
  const machineId = `machine-project-roots-${key}`;
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

function addRoot(sessionId: SessionId, machineId: string, path: string) {
  return t.mutation(api.machineProjectRoots.add, { sessionId, machineId, path });
}

function removeRoot(
  sessionId: SessionId,
  machineId: string,
  rootId: Awaited<ReturnType<typeof addRoot>>['rootId']
) {
  return t.mutation(api.machineProjectRoots.remove, { sessionId, machineId, rootId });
}

function listRoots(sessionId: SessionId, machineId: string) {
  return t.query(api.machineProjectRoots.list, { sessionId, machineId });
}

describe('machineProjectRoots.add / list', () => {
  test('adds a normalized root, lists it sorted, and returns an empty collapse', async () => {
    const { sessionId, machineId } = await setup('add-basic');

    const added = await addRoot(sessionId, machineId, '/Users/test/src/');
    expect(added.path).toBe('/Users/test/src');
    expect(added.collapsedPaths).toEqual([]);

    await addRoot(sessionId, machineId, '/Users/test/alpha');

    const { roots } = await listRoots(sessionId, machineId);
    expect(roots.map((root) => root.path)).toEqual(['/Users/test/alpha', '/Users/test/src']);
    expect(roots.find((root) => root.path === '/Users/test/src')).toMatchObject({
      rootId: added.rootId,
      path: '/Users/test/src',
    });
    expect(typeof roots[0]!.addedAt).toBe('number');
  });

  test('rejects an exact duplicate, including a trailing-slash variant', async () => {
    const { sessionId, machineId } = await setup('duplicate');
    await addRoot(sessionId, machineId, '/Users/test/src');

    await expect(addRoot(sessionId, machineId, '/Users/test/src')).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.PROJECT_ROOT_DUPLICATE },
    });
    await expect(addRoot(sessionId, machineId, '/Users/test/src/')).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.PROJECT_ROOT_DUPLICATE },
    });
  });

  test('rejects a child of an existing root and names the parent', async () => {
    const { sessionId, machineId } = await setup('nested');
    await addRoot(sessionId, machineId, '/Users/test/src');

    await expect(addRoot(sessionId, machineId, '/Users/test/src/pkg')).rejects.toMatchObject({
      data: {
        code: BACKEND_ERROR_CODES.PROJECT_ROOT_NESTED,
        message: expect.stringContaining('/Users/test/src'),
      },
    });
  });

  test('accepts a sibling that only shares a string prefix', async () => {
    const { sessionId, machineId } = await setup('sibling-prefix');
    await addRoot(sessionId, machineId, '/Users/test/src');

    const sibling = await addRoot(sessionId, machineId, '/Users/test/src-two');
    expect(sibling.path).toBe('/Users/test/src-two');
    expect(sibling.collapsedPaths).toEqual([]);
  });

  test('adding a parent collapses existing children in one transaction', async () => {
    const { sessionId, machineId } = await setup('collapse');
    await addRoot(sessionId, machineId, '/Users/test/src/b');
    await addRoot(sessionId, machineId, '/Users/test/other');
    await addRoot(sessionId, machineId, '/Users/test/src/a');

    const parent = await addRoot(sessionId, machineId, '/Users/test/src');
    expect(parent.collapsedPaths).toEqual(['/Users/test/src/a', '/Users/test/src/b']);

    const { roots } = await listRoots(sessionId, machineId);
    expect(roots.map((root) => root.path)).toEqual(['/Users/test/other', '/Users/test/src']);
  });

  test('rejects the 21st root but still allows a collapse that fits the limit', async () => {
    const { sessionId, machineId } = await setup('limit');
    for (let i = 0; i < 20; i++) {
      await addRoot(sessionId, machineId, `/Users/test/r${i}`);
    }

    await expect(addRoot(sessionId, machineId, '/Users/test/r20')).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.PROJECT_ROOT_LIMIT_REACHED },
    });

    // A parent of all 20 children lands at one root, so it is still allowed.
    const parent = await addRoot(sessionId, machineId, '/Users/test');
    expect(parent.collapsedPaths).toHaveLength(20);
    const { roots } = await listRoots(sessionId, machineId);
    expect(roots.map((root) => root.path)).toEqual(['/Users/test']);
  });

  test.each([
    ['relative path', 'relative/path'],
    ['home shortcut', '~/x'],
    ['filesystem root', '/'],
    ['parent traversal', '/a/../b'],
    ['current-dir segment', '/a/./b'],
    ['empty segment', '/a//b'],
    ['shell metacharacter', '/a;rm'],
  ])('rejects an invalid path (%s) with INVALID_WORKING_DIR', async (label, path) => {
    const { sessionId, machineId } = await setup(`invalid-${label.replace(/\W+/g, '-')}`);

    await expect(addRoot(sessionId, machineId, path)).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.INVALID_WORKING_DIR },
    });
  });
});

describe('machineProjectRoots.remove', () => {
  test('removes a root idempotently and without enqueuing on a no-op', async () => {
    const { sessionId, machineId } = await setup('remove');
    const added = await addRoot(sessionId, machineId, '/Users/test/src');
    await t.mutation(api.machines.markDaemonOffline, { sessionId, machineId });

    await expect(removeRoot(sessionId, machineId, added.rootId)).resolves.toEqual({
      removed: true,
    });
    await expect(removeRoot(sessionId, machineId, added.rootId)).resolves.toEqual({
      removed: false,
    });

    await expect(listRoots(sessionId, machineId)).resolves.toEqual({ roots: [] });
  });

  test('ignores a root id that belongs to another machine', async () => {
    const { sessionId, machineId } = await setup('remove-wrong-machine');
    const otherMachineId = 'machine-project-roots-other';
    await registerMachineWithDaemon(sessionId, otherMachineId);

    const added = await addRoot(sessionId, machineId, '/Users/test/src');

    await expect(removeRoot(sessionId, otherMachineId, added.rootId)).resolves.toEqual({
      removed: false,
    });
    await expect(listRoots(sessionId, machineId)).resolves.toEqual({
      roots: [{ rootId: added.rootId, path: '/Users/test/src', addedAt: expect.any(Number) }],
    });
  });
});

describe('machineProjectRoots offline behaviour', () => {
  test('rejects add while offline and allows remove', async () => {
    const { sessionId, machineId } = await setup('offline');
    const added = await addRoot(sessionId, machineId, '/Users/test/src');
    await t.mutation(api.machines.markDaemonOffline, { sessionId, machineId });

    await expect(addRoot(sessionId, machineId, '/Users/test/other')).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.MACHINE_OFFLINE },
    });
    await expect(removeRoot(sessionId, machineId, added.rootId)).resolves.toEqual({
      removed: true,
    });
  });
});

describe('machineProjectRoots ownership', () => {
  test('a non-owner sees no roots and cannot add or remove', async () => {
    const owner = await setup('owner');
    const intruder = await setup('intruder');

    const added = await addRoot(owner.sessionId, owner.machineId, '/Users/test/src');

    await expect(listRoots(intruder.sessionId, owner.machineId)).resolves.toEqual({ roots: [] });
    await expect(
      addRoot(intruder.sessionId, owner.machineId, '/Users/test/other')
    ).rejects.toMatchObject({ data: { code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE } });
    await expect(
      removeRoot(intruder.sessionId, owner.machineId, added.rootId)
    ).rejects.toMatchObject({ data: { code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE } });

    await expect(listRoots(owner.sessionId, owner.machineId)).resolves.toEqual({
      roots: [{ rootId: added.rootId, path: '/Users/test/src', addedAt: expect.any(Number) }],
    });
  });
});

describe('daemon.syncProjectRoots coalescing', () => {
  test('three adds share one pending nudge with the routine TTL', async () => {
    const { sessionId, machineId } = await setup('coalesce');
    await addRoot(sessionId, machineId, '/Users/test/a');
    await addRoot(sessionId, machineId, '/Users/test/b');
    await addRoot(sessionId, machineId, '/Users/test/c');

    const [command] = await getInboxCommandsForMachine(machineId, 'daemon.syncProjectRoots');
    expect(await getInboxCommandsForMachine(machineId, 'daemon.syncProjectRoots')).toHaveLength(1);
    expect(command!.command).toEqual({ type: 'daemon.syncProjectRoots' });
    expect(command!.deadline).toBeGreaterThan(command!.createdAt);
    expect(command!.deadline - command!.createdAt).toBe(300_000);
  });

  test('a remove while the nudge is pending adds no second command', async () => {
    const { sessionId, machineId } = await setup('coalesce-remove');
    const added = await addRoot(sessionId, machineId, '/Users/test/a');
    await removeRoot(sessionId, machineId, added.rootId);

    expect(await getInboxCommandsForMachine(machineId, 'daemon.syncProjectRoots')).toHaveLength(1);
  });

  test('a no-op remove does not enqueue', async () => {
    const { sessionId, machineId } = await setup('coalesce-noop');
    const added = await addRoot(sessionId, machineId, '/Users/test/a');
    await removeRoot(sessionId, machineId, added.rootId);

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', machineId).eq('status', 'pending')
        )
        .collect();
      for (const row of rows) await ctx.db.delete('chatroom_machineCommandInbox', row._id);
    });

    await expect(removeRoot(sessionId, machineId, added.rootId)).resolves.toEqual({
      removed: false,
    });
    expect(await getInboxCommandsForMachine(machineId, 'daemon.syncProjectRoots')).toEqual([]);
  });

  test('consuming the pending nudge lets the next add enqueue again', async () => {
    const { sessionId, machineId } = await setup('coalesce-consumed');
    await addRoot(sessionId, machineId, '/Users/test/a');

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', machineId).eq('status', 'pending')
        )
        .collect();
      for (const row of rows) await ctx.db.delete('chatroom_machineCommandInbox', row._id);
    });

    await addRoot(sessionId, machineId, '/Users/test/b');
    expect(await getInboxCommandsForMachine(machineId, 'daemon.syncProjectRoots')).toHaveLength(1);
  });
});

describe('machine deletion', () => {
  test('purges project roots with the rest of the machine', async () => {
    const { sessionId, machineId } = await setup('purge');
    await addRoot(sessionId, machineId, '/Users/test/a');
    await addRoot(sessionId, machineId, '/Users/test/b');
    await t.mutation(api.machines.markDaemonOffline, { sessionId, machineId });

    vi.useFakeTimers();
    try {
      await t.mutation(api.machines.deleteMachine, { sessionId, machineId });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    const rows = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineProjectRoots')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(rows).toEqual([]);
  });
});
