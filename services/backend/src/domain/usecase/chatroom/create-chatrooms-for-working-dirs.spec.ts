/**
 * Unit tests for createChatroomsForWorkingDirs (bulk chatroom create).
 *
 * The bulk path is a loop over createChatroomWithWorkspace: every unique directory creates one
 * room through the single creation use case, already-owned directories are skipped, and invalid
 * paths fail per item. Repeated calls write nothing, duplicates dedupe, archived rooms do not
 * block, and an unexpected throw aborts the whole transaction.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { createChatroomsForWorkingDirs } from './create-chatrooms-for-working-dirs';
import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { registerMachineWithDaemon } from '../../../../tests/helpers/integration';
import { getInboxCommandsForMachine } from '../../../../tests/helpers/machine-command-inbox';

async function setup(key: string) {
  const sessionId = `bulk-create-${key}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const machineId = `machine-bulk-create-${key}`;
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, ownerId: login.userId as Id<'users'>, machineId };
}

const bulkCreate = (ownerId: Id<'users'>, machineId: string, workingDirs: string[]) =>
  t.run((ctx) => createChatroomsForWorkingDirs(ctx, { ownerId, machineId, workingDirs }));

const chatrooms = () => t.run((ctx) => ctx.db.query('chatroom_rooms').collect());
const workspaces = () => t.run((ctx) => ctx.db.query('chatroom_workspaces').collect());

/** Inbox command types that start an agent. Bulk create must never enqueue one. */
function startAgentCommands(
  inbox: Awaited<ReturnType<typeof getInboxCommandsForMachine>>
): typeof inbox {
  return inbox.filter((row) => row.command.type === 'agent.requestStart');
}

describe('createChatroomsForWorkingDirs', () => {
  test('creates a trio chatroom per dir with the folder-derived name, workspace and primary row', async () => {
    const { sessionId, ownerId, machineId } = await setup('create');

    const result = await bulkCreate(ownerId, machineId, ['/work/repo-1', '/work/repo-2']);

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results.map((item) => item.workingDir)).toEqual(['/work/repo-1', '/work/repo-2']);

    const created = result.results.filter((item) => item.outcome === 'created');
    expect(created).toHaveLength(2);

    const expectedNames = ['repo-1', 'repo-2'];
    for (const [index, item] of created.entries()) {
      if (item.outcome !== 'created') throw new Error('unreachable');
      const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', item.chatroomId));
      expect(room!.name).toBe(expectedNames[index]);

      const team = await t.query(api.chatrooms.getTeamStructureForChatroom, {
        sessionId,
        chatroomId: item.chatroomId,
      });
      expect(team!.teamId).toBe('trio');

      const roomWorkspaces = await t.query(api.workspaces.listWorkspacesForChatroom, {
        sessionId,
        chatroomId: item.chatroomId,
      });
      expect(roomWorkspaces).toHaveLength(1);
      expect(roomWorkspaces[0]!._id).toBe(item.workspaceId);
      expect(roomWorkspaces[0]!.workingDir).toBe(item.workingDir);

      const primaryRows = await t.run((ctx) =>
        ctx.db
          .query('chatroom_primaryWorkspaces')
          .collect()
          .then((rows) => rows.filter((row) => row.chatroomId === item.chatroomId))
      );
      expect(primaryRows).toHaveLength(1);
      expect(primaryRows[0]!.workspaceId).toBe(item.workspaceId);
    }

    const inbox = await getInboxCommandsForMachine(machineId);
    expect(startAgentCommands(inbox)).toHaveLength(0);
  });

  test('a second identical call skips every dir with the existing chatroom id and inserts no rows', async () => {
    const { ownerId, machineId } = await setup('repeat');
    const dirs = ['/work/repo-1', '/work/repo-2'];
    const first = await bulkCreate(ownerId, machineId, dirs);
    const roomsBefore = (await chatrooms()).length;
    const workspacesBefore = (await workspaces()).length;

    const second = await bulkCreate(ownerId, machineId, dirs);

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.failed).toBe(0);
    for (const item of second.results) {
      if (item.outcome !== 'skipped') throw new Error('expected a skipped item');
      expect(item.reason).toBe('already_has_chatroom');
      const firstItem = first.results.find((candidate) => candidate.workingDir === item.workingDir);
      if (firstItem?.outcome !== 'created') throw new Error('expected a created first item');
      expect(item.chatroomId).toBe(firstItem.chatroomId);
    }
    expect((await chatrooms()).length).toBe(roomsBefore);
    expect((await workspaces()).length).toBe(workspacesBefore);
  });

  test('duplicates within one call and trailing-slash variants dedupe', async () => {
    const { ownerId, machineId } = await setup('dedupe');
    const roomsBefore = (await chatrooms()).length;

    const result = await bulkCreate(ownerId, machineId, [
      '/work/repo-1',
      '/work/repo-1/',
      '/work/repo-1',
      '/work/repo-2',
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.created).toBe(2);
    expect(result.results.map((item) => item.workingDir)).toEqual(['/work/repo-1', '/work/repo-2']);
    expect((await chatrooms()).length).toBe(roomsBefore + 2);
  });

  test('an invalid dir fails per item and valid dirs still create', async () => {
    const { ownerId, machineId } = await setup('invalid');
    const roomsBefore = (await chatrooms()).length;

    const result = await bulkCreate(ownerId, machineId, ['relative/dir', '/work/repo-1', '/']);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(2);

    const failed = result.results.filter((item) => item.outcome === 'failed');
    expect(failed.map((item) => item.workingDir)).toEqual(['relative/dir', '/']);
    for (const item of failed) {
      expect(item.outcome).toBe('failed');
      if (item.outcome !== 'failed') throw new Error('unreachable');
      expect(item.code).toBe('INVALID_WORKING_DIR');
      expect(item.message.length).toBeGreaterThan(0);
    }

    expect((await chatrooms()).length).toBe(roomsBefore + 1);
  });

  test('more than 50 dirs throws BULK_CREATE_LIMIT_EXCEEDED and writes nothing; exactly 50 succeeds', async () => {
    const { ownerId, machineId } = await setup('cap');
    const tooMany = Array.from({ length: 51 }, (_, index) => `/work/bulk-${index + 1}`);
    const roomsBefore = (await chatrooms()).length;

    await expect(bulkCreate(ownerId, machineId, tooMany)).rejects.toMatchObject({
      data: { code: BACKEND_ERROR_CODES.BULK_CREATE_LIMIT_EXCEEDED },
    });

    expect((await chatrooms()).length).toBe(roomsBefore);

    const atCap = Array.from({ length: 50 }, (_, index) => `/work/cap-${index + 1}`);
    const result = await bulkCreate(ownerId, machineId, atCap);
    expect(result.created).toBe(50);
    expect(result.results).toHaveLength(50);
  });

  test('an archived chatroom for a dir does not block creation', async () => {
    const { sessionId, ownerId, machineId } = await setup('archived');

    const first = await bulkCreate(ownerId, machineId, ['/work/archived-repo']);
    const firstItem = first.results[0]!;
    expect(firstItem.outcome).toBe('created');
    if (firstItem.outcome !== 'created') throw new Error('unreachable');

    await t.mutation(api.chatrooms.archive, {
      sessionId,
      chatroomId: firstItem.chatroomId,
    });

    const second = await bulkCreate(ownerId, machineId, ['/work/archived-repo']);
    expect(second.results).toHaveLength(1);
    const secondItem = second.results[0]!;
    expect(secondItem.outcome).toBe('created');
    if (secondItem.outcome !== 'created') throw new Error('unreachable');
    expect(secondItem.chatroomId).not.toBe(firstItem.chatroomId);
  });

  test("another user's chatroom on the same dir does not cause a skip", async () => {
    const ownerA = await setup('owner-a');
    const ownerB = await setup('owner-b');

    const resultA = await bulkCreate(ownerA.ownerId, ownerA.machineId, ['/work/shared']);
    expect(resultA.results[0]!.outcome).toBe('created');

    const resultB = await bulkCreate(ownerB.ownerId, ownerB.machineId, ['/work/shared']);
    expect(resultB.results).toHaveLength(1);
    expect(resultB.results[0]!.outcome).toBe('created');
  });

  test('an error thrown after writes rolls the whole transaction back and a retry succeeds', async () => {
    const { ownerId, machineId } = await setup('atomic');
    const dirs = ['/work/atomic-1', '/work/atomic-2'];
    const roomsBefore = (await chatrooms()).length;
    const workspacesBefore = (await workspaces()).length;

    await expect(
      t.run(async (ctx) => {
        await createChatroomsForWorkingDirs(ctx, { ownerId, machineId, workingDirs: dirs });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect((await chatrooms()).length).toBe(roomsBefore);
    expect((await workspaces()).length).toBe(workspacesBefore);

    const retry = await bulkCreate(ownerId, machineId, dirs);
    expect(retry.created).toBe(2);
    expect((await chatrooms()).length).toBe(roomsBefore + 2);
  });
});
