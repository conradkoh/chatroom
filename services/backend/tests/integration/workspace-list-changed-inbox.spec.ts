/** Verifies workspace-list inbox nudges are emitted for watch starts, not throttled heartbeats. */
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';
import { createDuoTeamChatroom, createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('workspace-list-changed inbox', () => {
  test('observation enqueue is not duplicated by throttled heartbeat', async () => {
    const { sessionId } = await createTestSession('workspace-list-inbox');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'workspace-list-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, { sessionId: sessionId as any, chatroomId, machineId, workingDir: '/tmp/workspace-list', hostname: 'test', registeredBy: 'test' });
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId: sessionId as any, chatroomId });
    const count = (await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged')).length;
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId: sessionId as any, chatroomId });
    expect((await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged')).length).toBe(count);
  });
});
