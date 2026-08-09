/**
 * P8-T6 backfillOrchestrationHost — Integration Tests
 *
 * Verifies: single-machine chatrooms get orchestration host fields populated;
 * multi-machine chatrooms are left unset (multi-machine unsupported — no
 * migration path).
 */

import { describe, expect, test } from 'vitest';

import { internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function runBackfillOrchestrationHost() {
  return await t.mutation(internal.migrations.backfillOrchestrationHost, {
    cursor: null,
    batchSize: 100,
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

describe('migration: backfillOrchestrationHost', () => {
  test('populates host fields for a single-machine chatroom', async () => {
    const { sessionId } = await createTestSession('p8-backfill-single');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'p8-backfill-single-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

    await runBackfillOrchestrationHost();

    const host = await getOrchestrationHost(chatroomId);
    expect(host).toEqual({
      orchestrationMachineId: machineId,
      orchestrationWorkingDir: '/test/workspace',
    });
  });

  test('leaves host fields unset for a multi-machine chatroom', async () => {
    const { sessionId } = await createTestSession('p8-backfill-multi');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await registerMachineWithDaemon(sessionId, 'p8-backfill-machine-a');
    await registerMachineWithDaemon(sessionId, 'p8-backfill-machine-b');
    await setupRemoteAgentConfig(sessionId, chatroomId, 'p8-backfill-machine-a', 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, 'p8-backfill-machine-b', 'planner');

    await runBackfillOrchestrationHost();

    const host = await getOrchestrationHost(chatroomId);
    expect(host.orchestrationMachineId).toBeUndefined();
    expect(host.orchestrationWorkingDir).toBeUndefined();
  });
});
