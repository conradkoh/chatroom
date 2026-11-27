/**
 * agents.requestStart / agents.requestRestart — one-workspace binding guard.
 *
 * A chatroom with an active workspace may only start or restart agents on that
 * workspace's machine and folder. Driven through public mutations; `t.run` is
 * used only to count rows.
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

/** Binds the chatroom's workspace through the public mutation (the one-workspace cap allows one). */
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

function start(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
) {
  return t.mutation(api.agents.requestStart, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    agentHarness: 'opencode-sdk',
    model: TEST_MODEL_OPENCODE_LEGACY,
    workingDir,
  });
}

function restart(
  sessionId: SessionId,
  chatroomId: ChatroomId,
  machineId: string,
  workingDir: string
) {
  return t.mutation(api.agents.requestRestart, {
    sessionId,
    machineId,
    chatroomId,
    role: 'builder',
    agentHarness: 'opencode-sdk',
    model: TEST_MODEL_OPENCODE_LEGACY,
    workingDir,
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

describe('agents.requestStart — one-workspace binding guard', () => {
  test('first bind: any target is accepted when the chatroom has no active workspace', async () => {
    const { sessionId, chatroomId } = await setup('bind-first');
    await registerMachineWithDaemon(sessionId, 'machine-bind-first');

    await start(sessionId, chatroomId, 'machine-bind-first', '/work/a');

    expect(
      await getInboxCommandsForMachine('machine-bind-first', 'agent.requestStart')
    ).toHaveLength(1);
  });

  test('same machine and folder as the active workspace is accepted; trailing slash is ignored', async () => {
    const { sessionId, chatroomId } = await setup('bind-same');
    await registerMachineWithDaemon(sessionId, 'machine-bind-same');
    await bind(sessionId, chatroomId, 'machine-bind-same', '/work/a');

    await start(sessionId, chatroomId, 'machine-bind-same', '/work/a/');

    expect(
      await getInboxCommandsForMachine('machine-bind-same', 'agent.requestStart')
    ).toHaveLength(1);
  });

  test('different folder on the bound machine is refused; nothing is enqueued or written', async () => {
    const { sessionId, chatroomId } = await setup('bind-dir');
    await registerMachineWithDaemon(sessionId, 'machine-bind-dir');
    await bind(sessionId, chatroomId, 'machine-bind-dir', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    const message = await expectRefused(
      start(sessionId, chatroomId, 'machine-bind-dir', '/work/b'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(message).toContain('test-host:/work/a');
    expect(message).toContain('Use Switch workspace to move it.');
    expect(await getInboxCommandsForMachine('machine-bind-dir', 'agent.requestStart')).toHaveLength(
      0
    );
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });

  test('different machine is refused; nothing is enqueued on either machine', async () => {
    const { sessionId, chatroomId } = await setup('bind-machine');
    await registerMachineWithDaemon(sessionId, 'machine-bind-a');
    await registerMachineWithDaemon(sessionId, 'machine-bind-b');
    await bind(sessionId, chatroomId, 'machine-bind-a', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expectRefused(
      start(sessionId, chatroomId, 'machine-bind-b', '/work/a'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(await getInboxCommandsForMachine('machine-bind-b', 'agent.requestStart')).toHaveLength(
      0
    );
    expect(await getInboxCommandsForMachine('machine-bind-a', 'agent.requestStart')).toHaveLength(
      0
    );
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });
});

describe('agents.requestRestart — one-workspace binding guard', () => {
  test('same target as the active workspace is accepted', async () => {
    const { sessionId, chatroomId } = await setup('restart-same');
    await registerMachineWithDaemon(sessionId, 'machine-restart-same');
    // A prior start records the remote config that restart needs; it runs before any workspace is bound.
    await start(sessionId, chatroomId, 'machine-restart-same', '/work/a');
    await bind(sessionId, chatroomId, 'machine-restart-same', '/work/a');

    const result = await restart(sessionId, chatroomId, 'machine-restart-same', '/work/a');

    expect(result.status).toBe('requested');
    expect(await getInboxCommandsForMachine('machine-restart-same', 'agent.restart')).toHaveLength(
      1
    );
  });

  test('different folder is refused; no restart is enqueued and no launch row is written', async () => {
    const { sessionId, chatroomId } = await setup('restart-dir');
    await registerMachineWithDaemon(sessionId, 'machine-restart-dir');
    await start(sessionId, chatroomId, 'machine-restart-dir', '/work/a');
    await bind(sessionId, chatroomId, 'machine-restart-dir', '/work/a');
    const launchesBefore = await launchRequestCount(chatroomId);

    await expectRefused(
      restart(sessionId, chatroomId, 'machine-restart-dir', '/work/b'),
      'WORKSPACE_ALREADY_BOUND'
    );

    expect(await getInboxCommandsForMachine('machine-restart-dir', 'agent.restart')).toHaveLength(
      0
    );
    expect(await launchRequestCount(chatroomId)).toBe(launchesBefore);
  });
});
