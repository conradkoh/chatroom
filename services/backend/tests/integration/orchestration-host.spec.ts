/**
 * P8 orchestration host — Integration Tests
 *
 * Verifies: same-machine config patches succeed and sync orchestration host
 * fields; shadow mode (P8 on, cutover off) allows multi-machine patches and
 * clears host fields; cutover mode rejects multi-machine patches with
 * ORCHESTRATION_HOST_CONFLICT.
 */

import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { TEST_MODEL_OPENCODE } from '../helpers/test-models';

const P8 = 'DAEMON_ORCHESTRATION_P8';
const P8_CUTOVER = 'DAEMON_ORCHESTRATION_P8_CUTOVER';

function withP8(cutover: boolean): void {
  process.env[P8] = '1';
  if (cutover) {
    process.env[P8_CUTOVER] = '1';
  }
}

async function saveRemoteConfig(args: {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  workingDir: string;
}): Promise<void> {
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId: args.sessionId,
    chatroomId: args.chatroomId,
    role: args.role,
    type: 'remote',
    machineId: args.machineId,
    agentHarness: 'opencode',
    model: TEST_MODEL_OPENCODE,
    workingDir: args.workingDir,
  });
}

async function getOrchestrationHost(chatroomId: Id<'chatroom_rooms'>): Promise<{
  orchestrationMachineId?: string;
  orchestrationWorkingDir?: string;
}> {
  return t.run(async (ctx) => {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    return {
      orchestrationMachineId: chatroom?.orchestrationMachineId,
      orchestrationWorkingDir: chatroom?.orchestrationWorkingDir,
    };
  });
}

describe('P8 orchestration host validation', () => {
  afterEach(() => {
    delete process.env[P8];
    delete process.env[P8_CUTOVER];
  });

  test('same-machine remote configs sync orchestration host fields', async () => {
    withP8(true);
    const { sessionId } = await createTestSession('p8-host-same');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await registerMachineWithDaemon(sessionId, 'p8-same-machine');

    await saveRemoteConfig({
      sessionId,
      chatroomId,
      role: 'builder',
      machineId: 'p8-same-machine',
      workingDir: '/test/workspace',
    });
    await saveRemoteConfig({
      sessionId,
      chatroomId,
      role: 'planner',
      machineId: 'p8-same-machine',
      workingDir: '/test/workspace',
    });

    const host = await getOrchestrationHost(chatroomId);
    expect(host).toEqual({
      orchestrationMachineId: 'p8-same-machine',
      orchestrationWorkingDir: '/test/workspace',
    });
  });

  test('shadow mode: multi-machine patch succeeds and clears host fields', async () => {
    withP8(false);
    const { sessionId } = await createTestSession('p8-host-shadow');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await registerMachineWithDaemon(sessionId, 'p8-shadow-machine-a');
    await registerMachineWithDaemon(sessionId, 'p8-shadow-machine-b');

    await saveRemoteConfig({
      sessionId,
      chatroomId,
      role: 'builder',
      machineId: 'p8-shadow-machine-a',
      workingDir: '/test/workspace',
    });

    // Second machine for planner — should NOT throw in shadow mode.
    await expect(
      saveRemoteConfig({
        sessionId,
        chatroomId,
        role: 'planner',
        machineId: 'p8-shadow-machine-b',
        workingDir: '/test/workspace',
      })
    ).resolves.toBeUndefined();

    const host = await getOrchestrationHost(chatroomId);
    expect(host.orchestrationMachineId).toBeUndefined();
    expect(host.orchestrationWorkingDir).toBeUndefined();
  });

  test('cutover mode: multi-machine patch is rejected with ORCHESTRATION_HOST_CONFLICT', async () => {
    withP8(true);
    const { sessionId } = await createTestSession('p8-host-cutover');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await registerMachineWithDaemon(sessionId, 'p8-cutover-machine-a');
    await registerMachineWithDaemon(sessionId, 'p8-cutover-machine-b');

    await saveRemoteConfig({
      sessionId,
      chatroomId,
      role: 'builder',
      machineId: 'p8-cutover-machine-a',
      workingDir: '/test/workspace',
    });

    const err = await t
      .mutation(api.machines.saveTeamAgentConfig, {
        sessionId,
        chatroomId,
        role: 'planner',
        type: 'remote',
        machineId: 'p8-cutover-machine-b',
        agentHarness: 'opencode',
        model: TEST_MODEL_OPENCODE,
        workingDir: '/test/workspace',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError).data).toMatchObject({ code: 'ORCHESTRATION_HOST_CONFLICT' });
  });
});
