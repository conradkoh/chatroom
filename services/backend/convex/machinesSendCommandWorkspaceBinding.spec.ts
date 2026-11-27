/**
 * machines.sendCommand start-agent / restart-agent — workspace guards.
 *
 * Two orthogonal policies are covered:
 *   1. One-workspace binding (PR #1855): a chatroom with an active workspace may only start or
 *      restart agents on that workspace's machine and folder.
 *   2. Workspace-id ownership: a supplied `payload.workspaceId` must exist, belong to the
 *      chatroom, still be active, and match the target machine and normalized working directory.
 *
 * Driven through public mutations; `t.run` counts rows and seeds workspaces the one-workspace
 * cap refuses.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { registerWorkspace as registerWorkspaceUseCase } from '../src/domain/usecase/workspace/register-workspace';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../tests/helpers/integration';
import { getInboxCommandsForMachine } from '../tests/helpers/machine-command-inbox';
import { TEST_MODEL_OPENCODE_LEGACY } from '../tests/helpers/test-models';

type ChatroomId = Id<'chatroom_rooms'>;
type WorkspaceId = Id<'chatroom_workspaces'>;

async function setup(
  sessionKey: string
): Promise<{ sessionId: SessionId; chatroomId: ChatroomId }> {
  const { sessionId } = await createTestSession(sessionKey);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  return { sessionId, chatroomId };
}

/** Binds the chatroom's workspace through the public mutation (the cap allows one). */
function bind(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
): Promise<WorkspaceId> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'user',
  });
}

/**
 * Seeds an ACTIVE workspace the public mutation refuses (the chatroom cap allows one).
 * Reproduces stale or duplicate workspace rows that the ownership rule must reject.
 */
function seedWorkspace(
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
): Promise<WorkspaceId> {
  return t.run((ctx) =>
    registerWorkspaceUseCase(ctx, {
      chatroomId,
      machineId,
      workingDir,
      hostname: 'test-host',
      registeredBy: 'test',
    })
  );
}

function setPrimary(sessionId: SessionId, chatroomId: ChatroomId, workspaceId: WorkspaceId) {
  return t.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
    sessionId,
    chatroomId,
    workspaceId,
  });
}

function sendStart(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string,
  workspaceId?: WorkspaceId
) {
  return t.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role: 'builder',
      model: TEST_MODEL_OPENCODE_LEGACY,
      agentHarness: 'opencode-sdk',
      workingDir,
      ...(workspaceId ? { workspaceId } : {}),
    },
  });
}

function sendRestart(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string,
  workspaceId?: WorkspaceId
) {
  return t.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'restart-agent',
    payload: {
      chatroomId,
      role: 'builder',
      model: TEST_MODEL_OPENCODE_LEGACY,
      agentHarness: 'opencode-sdk',
      workingDir,
      ...(workspaceId ? { workspaceId } : {}),
    },
  });
}

async function launchRequestCount(chatroomId: ChatroomId): Promise<number> {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('chatroom_agentLastSentLaunchRequests')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect()
      ).length
  );
}

/** Asserts no launch command of `commandType` sits on any listed machine and no launch row was written. */
async function expectNoLaunchWrites(
  chatroomId: ChatroomId,
  machineIds: readonly string[],
  commandType: 'agent.requestStart' | 'agent.restart',
  launchesBefore: number
): Promise<void> {
  for (const machineId of machineIds) {
    expect(await getInboxCommandsForMachine(machineId, commandType)).toHaveLength(0);
  }
  expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
}

/** Resolves with the refusal's `data.message` after asserting the code; fails if the call succeeds. */
async function expectRefused(promise: Promise<unknown>, code: string): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toMatchObject({ data: { code } });
  return (error as { data: { message: string } }).data.message;
}

describe('machines.sendCommand start-agent — one-workspace binding guard', () => {
  test('first bind: any target is accepted when the chatroom has no active workspace', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-start-first');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-start-first');

    await sendStart(sessionId, chatroomId, 'machine-mcmd-start-first', '/work/a');

    expect(
      await getInboxCommandsForMachine('machine-mcmd-start-first', 'agent.requestStart')
    ).toHaveLength(1);
  });

  test('same machine and folder as the active workspace is accepted; trailing slash is ignored', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-start-same');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-start-same');
    await bind(sessionId, chatroomId, 'machine-mcmd-start-same', '/work/a');

    await sendStart(sessionId, chatroomId, 'machine-mcmd-start-same', '/work/a/');

    expect(
      await getInboxCommandsForMachine('machine-mcmd-start-same', 'agent.requestStart')
    ).toHaveLength(1);
  });

  test('different folder on the bound machine is refused; nothing is enqueued or written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-start-dir');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-start-dir');
    await bind(sessionId, chatroomId, 'machine-mcmd-start-dir', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    const message = await expectRefused(
      sendStart(sessionId, chatroomId, 'machine-mcmd-start-dir', '/work/b'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(message).toContain('test-host:/work/a');
    expect(
      await getInboxCommandsForMachine('machine-mcmd-start-dir', 'agent.requestStart')
    ).toHaveLength(0);
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });

  test('different machine is refused; nothing is enqueued on either machine', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-start-machine');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-start-a');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-start-b');
    await bind(sessionId, chatroomId, 'machine-mcmd-start-a', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expectRefused(
      sendStart(sessionId, chatroomId, 'machine-mcmd-start-b', '/work/a'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(
      await getInboxCommandsForMachine('machine-mcmd-start-b', 'agent.requestStart')
    ).toHaveLength(0);
    expect(
      await getInboxCommandsForMachine('machine-mcmd-start-a', 'agent.requestStart')
    ).toHaveLength(0);
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });
});

describe('machines.sendCommand restart-agent — one-workspace binding guard', () => {
  test('same target as the active workspace is accepted', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-restart-same');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-restart-same');
    // A prior start records the remote config that restart needs; it runs before any workspace is bound.
    await sendStart(sessionId, chatroomId, 'machine-mcmd-restart-same', '/work/a');
    await bind(sessionId, chatroomId, 'machine-mcmd-restart-same', '/work/a');

    await sendRestart(sessionId, chatroomId, 'machine-mcmd-restart-same', '/work/a');

    expect(
      await getInboxCommandsForMachine('machine-mcmd-restart-same', 'agent.restart')
    ).toHaveLength(1);
  });

  test('no active workspace: restart to any target is accepted', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-restart-unbound');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-restart-unbound');
    await sendStart(sessionId, chatroomId, 'machine-mcmd-restart-unbound', '/work/a');

    await sendRestart(sessionId, chatroomId, 'machine-mcmd-restart-unbound', '/work/b');

    expect(
      await getInboxCommandsForMachine('machine-mcmd-restart-unbound', 'agent.restart')
    ).toHaveLength(1);
  });

  test('different folder is refused; no restart is enqueued and no launch row is written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-restart-dir');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-restart-dir');
    await sendStart(sessionId, chatroomId, 'machine-mcmd-restart-dir', '/work/a');
    await bind(sessionId, chatroomId, 'machine-mcmd-restart-dir', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expectRefused(
      sendRestart(sessionId, chatroomId, 'machine-mcmd-restart-dir', '/work/b'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(
      await getInboxCommandsForMachine('machine-mcmd-restart-dir', 'agent.restart')
    ).toHaveLength(0);
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });

  test('different machine is refused; no restart is enqueued on either machine', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-restart-machine');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-restart-a');
    await registerMachineWithDaemon(sessionId, 'machine-mcmd-restart-b');
    await sendStart(sessionId, chatroomId, 'machine-mcmd-restart-a', '/work/a');
    await bind(sessionId, chatroomId, 'machine-mcmd-restart-a', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expectRefused(
      sendRestart(sessionId, chatroomId, 'machine-mcmd-restart-b', '/work/a'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(
      await getInboxCommandsForMachine('machine-mcmd-restart-b', 'agent.restart')
    ).toHaveLength(0);
    expect(
      await getInboxCommandsForMachine('machine-mcmd-restart-a', 'agent.restart')
    ).toHaveLength(0);
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });
});

describe('machines.sendCommand start-agent — workspaceId ownership guard', () => {
  test('workspace from another chatroom is refused; nothing is enqueued or written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-start-chatroom');
    const machineId = 'machine-ws-start-chatroom';
    await registerMachineWithDaemon(sessionId, machineId);
    await bind(sessionId, chatroomId, machineId, '/work/a');
    const foreignChatroomId = await createDuoTeamChatroom(sessionId);
    const foreignWorkspaceId = await bind(sessionId, foreignChatroomId, machineId, '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendStart(sessionId, chatroomId, machineId, '/work/a', foreignWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent start request');

    await expectNoLaunchWrites(chatroomId, [machineId], 'agent.requestStart', launchesBefore);
  });

  test('workspace on another machine is refused; nothing is enqueued or written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-start-machine');
    const activeMachine = 'machine-ws-start-active';
    const otherMachine = 'machine-ws-start-other';
    await registerMachineWithDaemon(sessionId, activeMachine);
    await registerMachineWithDaemon(sessionId, otherMachine);
    const activeWorkspaceId = await bind(sessionId, chatroomId, activeMachine, '/work/a');
    // A second ACTIVE workspace on another machine is unreachable through the public mutation.
    const foreignWorkspaceId = await seedWorkspace(chatroomId, otherMachine, '/work/a');
    await setPrimary(sessionId, chatroomId, activeWorkspaceId);
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendStart(sessionId, chatroomId, activeMachine, '/work/a', foreignWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent start request');

    await expectNoLaunchWrites(
      chatroomId,
      [activeMachine, otherMachine],
      'agent.requestStart',
      launchesBefore
    );
  });

  test('removed workspace is refused; nothing is enqueued or written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-start-removed');
    const machineId = 'machine-ws-start-removed';
    await registerMachineWithDaemon(sessionId, machineId);
    const removedWorkspaceId = await bind(sessionId, chatroomId, machineId, '/work/old');
    // Switching away soft-deletes the old row: the id still resolves, but is no longer active.
    await t.mutation(api.workspaces.switchWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/work/a',
    });
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendStart(sessionId, chatroomId, machineId, '/work/a', removedWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent start request');

    await expectNoLaunchWrites(chatroomId, [machineId], 'agent.requestStart', launchesBefore);
  });

  test('workspace whose working directory differs is refused; nothing is enqueued or written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-start-dir');
    const machineId = 'machine-ws-start-dir';
    await registerMachineWithDaemon(sessionId, machineId);
    const activeWorkspaceId = await bind(sessionId, chatroomId, machineId, '/work/a');
    const otherFolderWorkspaceId = await seedWorkspace(chatroomId, machineId, '/work/b');
    await setPrimary(sessionId, chatroomId, activeWorkspaceId);
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendStart(sessionId, chatroomId, machineId, '/work/a', otherFolderWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent start request');

    await expectNoLaunchWrites(chatroomId, [machineId], 'agent.requestStart', launchesBefore);
  });

  test('matching workspace with a trailing slash starts normally', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-start-ok');
    const machineId = 'machine-ws-start-ok';
    await registerMachineWithDaemon(sessionId, machineId);
    const workspaceId = await bind(sessionId, chatroomId, machineId, '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await sendStart(sessionId, chatroomId, machineId, '/work/a/', workspaceId);

    expect(await getInboxCommandsForMachine(machineId, 'agent.requestStart')).toHaveLength(1);
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore + 1);
  });
});

describe('machines.sendCommand restart-agent — workspaceId ownership guard', () => {
  test('matching workspace restarts normally; trailing slash is ignored', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-restart-ok');
    const machineId = 'machine-ws-restart-ok';
    await registerMachineWithDaemon(sessionId, machineId);
    await sendStart(sessionId, chatroomId, machineId, '/work/a');
    const workspaceId = await bind(sessionId, chatroomId, machineId, '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await sendRestart(sessionId, chatroomId, machineId, '/work/a/', workspaceId);

    expect(await getInboxCommandsForMachine(machineId, 'agent.restart')).toHaveLength(1);
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore + 1);
  });

  test('workspace from another chatroom is refused; no restart is enqueued and no launch row is written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-restart-chatroom');
    const machineId = 'machine-ws-restart-chatroom';
    await registerMachineWithDaemon(sessionId, machineId);
    // Legacy snapshot first: it is what the unfixed path resolves across the chatroom boundary.
    await sendStart(sessionId, chatroomId, machineId, '/work/a');
    await bind(sessionId, chatroomId, machineId, '/work/a');
    const foreignChatroomId = await createDuoTeamChatroom(sessionId);
    const foreignWorkspaceId = await bind(sessionId, foreignChatroomId, machineId, '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendRestart(sessionId, chatroomId, machineId, '/work/a', foreignWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent restart request');

    await expectNoLaunchWrites(chatroomId, [machineId], 'agent.restart', launchesBefore);
  });

  test('workspace on another machine is refused; no restart is enqueued and no launch row is written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-restart-machine');
    const activeMachine = 'machine-ws-restart-active';
    const otherMachine = 'machine-ws-restart-other';
    await registerMachineWithDaemon(sessionId, activeMachine);
    await registerMachineWithDaemon(sessionId, otherMachine);
    await sendStart(sessionId, chatroomId, activeMachine, '/work/a');
    const activeWorkspaceId = await bind(sessionId, chatroomId, activeMachine, '/work/a');
    const foreignWorkspaceId = await seedWorkspace(chatroomId, otherMachine, '/work/a');
    await setPrimary(sessionId, chatroomId, activeWorkspaceId);
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendRestart(sessionId, chatroomId, activeMachine, '/work/a', foreignWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent restart request');

    await expectNoLaunchWrites(
      chatroomId,
      [activeMachine, otherMachine],
      'agent.restart',
      launchesBefore
    );
  });

  test('removed workspace is refused; no restart is enqueued and no launch row is written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-restart-removed');
    const machineId = 'machine-ws-restart-removed';
    await registerMachineWithDaemon(sessionId, machineId);
    const removedWorkspaceId = await bind(sessionId, chatroomId, machineId, '/work/old');
    await t.mutation(api.workspaces.switchWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/work/a',
    });
    await sendStart(sessionId, chatroomId, machineId, '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendRestart(sessionId, chatroomId, machineId, '/work/a', removedWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent restart request');

    await expectNoLaunchWrites(chatroomId, [machineId], 'agent.restart', launchesBefore);
  });

  test('workspace whose working directory differs is refused; no restart is enqueued and no launch row is written', async () => {
    const { sessionId, chatroomId } = await setup('mcmd-ws-restart-dir');
    const machineId = 'machine-ws-restart-dir';
    await registerMachineWithDaemon(sessionId, machineId);
    await sendStart(sessionId, chatroomId, machineId, '/work/a');
    const activeWorkspaceId = await bind(sessionId, chatroomId, machineId, '/work/a');
    const otherFolderWorkspaceId = await seedWorkspace(chatroomId, machineId, '/work/b');
    await setPrimary(sessionId, chatroomId, activeWorkspaceId);
    const launchesBefore = await launchRequestCount(chatroomId);

    await expect(
      sendRestart(sessionId, chatroomId, machineId, '/work/a', otherFolderWorkspaceId)
    ).rejects.toThrow('Workspace does not belong to this agent restart request');

    await expectNoLaunchWrites(chatroomId, [machineId], 'agent.restart', launchesBefore);
  });
});
