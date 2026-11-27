/**
 * machines.sendCommand start-agent / restart-agent — one-workspace binding guard.
 *
 * Mirrors agents.requestStart / agents.requestRestart: a chatroom with an active workspace may
 * only start or restart agents on that workspace's machine and folder. Driven through public
 * mutations; `t.run` is used only to count rows.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../tests/helpers/integration';
import { getInboxCommandsForMachine } from '../tests/helpers/machine-command-inbox';
import { TEST_MODEL_OPENCODE_LEGACY } from '../tests/helpers/test-models';

type ChatroomId = Id<'chatroom_rooms'>;

async function setup(
  sessionKey: string
): Promise<{ sessionId: SessionId; chatroomId: ChatroomId }> {
  const { sessionId } = await createTestSession(sessionKey);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  return { sessionId, chatroomId };
}

/** Binds the chatroom's workspace through the public mutation (the cap allows one). */
function bind(sessionId: SessionId, chatroomId: ChatroomId, machineId: string, workingDir: string) {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'user',
  });
}

function sendStart(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
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
    },
  });
}

function sendRestart(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
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
