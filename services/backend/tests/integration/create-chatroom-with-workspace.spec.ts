/**
 * chatrooms.createWithWorkspace — Integration Tests
 *
 * Covers the atomic create: room, team structure, workspace, primary workspace and the
 * daemon.gitRefresh enqueue. Invalid input must leave no partial state.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

type SessionId = Awaited<ReturnType<typeof createTestSession>>['sessionId'];

const WORKING_DIR = '/Users/test/src/my-app';

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

function createWithWorkspace(
  sessionId: SessionId,
  machineId: string,
  overrides: { teamStructureId?: string; workingDir?: string } = {}
) {
  return t.mutation(api.chatrooms.createWithWorkspace, {
    sessionId,
    machineId,
    teamStructureId: overrides.teamStructureId ?? 'duo@1',
    workingDir: overrides.workingDir ?? WORKING_DIR,
  });
}

async function roomCount(sessionId: SessionId): Promise<number> {
  return (await t.query(api.chatrooms.listByUser, { sessionId })).length;
}

describe('chatrooms.createWithWorkspace', () => {
  test('creates the room, team, workspace, primary workspace and one gitRefresh', async () => {
    const { sessionId, machineId } = await setupMachine('test-cw-success', 'machine-cw-success');

    const { chatroomId, workspaceId } = await createWithWorkspace(sessionId, machineId);

    const room = await t.query(api.chatrooms.get, { sessionId, chatroomId });
    expect(room!.name).toBe('my-app');

    const team = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(team!.teamId).toBe('duo');

    const workspaces = await t.query(api.workspaces.listWorkspacesForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!._id).toBe(workspaceId);
    expect(workspaces[0]!.workingDir).toBe(WORKING_DIR);
    expect(workspaces[0]!.machineId).toBe(machineId);
    expect(workspaces[0]!.removedAt).toBeUndefined();

    const primary = await t.query(api.workspaces.getPrimaryWorkspaceForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(primary!._id).toBe(workspaceId);

    const refreshes = await getInboxCommandsForMachine(machineId, 'daemon.gitRefresh');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.command).toEqual({ type: 'daemon.gitRefresh', workingDir: WORKING_DIR });
  });

  test('stores the normalized working dir without a trailing slash', async () => {
    const { sessionId, machineId } = await setupMachine('test-cw-slash', 'machine-cw-slash');

    const { chatroomId, workspaceId } = await createWithWorkspace(sessionId, machineId, {
      workingDir: `${WORKING_DIR}/`,
    });

    const workspaces = await t.query(api.workspaces.listWorkspacesForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!._id).toBe(workspaceId);
    expect(workspaces[0]!.workingDir).toBe(WORKING_DIR);
    const refreshes = await getInboxCommandsForMachine(machineId, 'daemon.gitRefresh');
    expect(refreshes[0]!.command).toMatchObject({ workingDir: WORKING_DIR });
  });

  test.each([
    ['relative path', 'relative/path/my-app'],
    ['shell metacharacter', '/Users/test/my-app;rm'],
    ['tilde', '~/src/my-app'],
    ['filesystem root', '/'],
  ])('rejects a %s working dir and creates nothing', async (_label, workingDir) => {
    const key = `test-cw-bad-dir-${_label.replace(/\W+/g, '-')}`;
    const { sessionId, machineId } = await setupMachine(key, `machine-${key}`);
    const before = await roomCount(sessionId);

    await expect(createWithWorkspace(sessionId, machineId, { workingDir })).rejects.toThrow();

    expect(await roomCount(sessionId)).toBe(before);
    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitRefresh')).toHaveLength(0);
  });

  test('rejects an unknown team structure and creates nothing', async () => {
    const { sessionId, machineId } = await setupMachine('test-cw-bad-team', 'machine-cw-bad-team');
    const before = await roomCount(sessionId);

    await expect(
      createWithWorkspace(sessionId, machineId, { teamStructureId: 'nope@9' })
    ).rejects.toMatchObject({ data: { code: 'UNKNOWN_TEAM_STRUCTURE' } });

    expect(await roomCount(sessionId)).toBe(before);
    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitRefresh')).toHaveLength(0);
  });

  test('rejects a machine owned by another user and creates nothing', async () => {
    const { machineId } = await setupMachine('test-cw-owner', 'machine-cw-owner');
    const { sessionId: otherSessionId } = await createTestSession('test-cw-other-user');
    const before = await roomCount(otherSessionId);

    await expect(createWithWorkspace(otherSessionId, machineId)).rejects.toThrow();

    expect(await roomCount(otherSessionId)).toBe(before);
    expect(await getInboxCommandsForMachine(machineId, 'daemon.gitRefresh')).toHaveLength(0);
  });

  test('rejects an unknown machine and creates nothing', async () => {
    const { sessionId } = await createTestSession('test-cw-unknown-machine');
    const before = await roomCount(sessionId);

    // requireMachineOwner runs first, so an unknown machine fails the owner check.
    await expect(createWithWorkspace(sessionId, 'machine-does-not-exist')).rejects.toMatchObject({
      data: { code: 'NOT_AUTHORIZED_MACHINE' },
    });

    expect(await roomCount(sessionId)).toBe(before);
  });

  test('truncates a long derived name to 100 characters', async () => {
    const { sessionId, machineId } = await setupMachine('test-cw-long', 'machine-cw-long');
    const longName = 'x'.repeat(150);

    const { chatroomId } = await createWithWorkspace(sessionId, machineId, {
      workingDir: `/Users/test/${longName}`,
    });

    const room = await t.query(api.chatrooms.get, { sessionId, chatroomId });
    expect(room!.name).toHaveLength(100);
  });
});
