/** Chatroom-level agent lifecycle fan-out integration coverage. */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('agents.requestChatroomAgentOperation', () => {
  test('queues one workspace-scoped stop per active workspace', async () => {
    const { sessionId } = await createTestSession('chatroom-agent-operation');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-chatroom-agent-operation';
    await registerMachineWithDaemon(sessionId, machineId);

    for (const workingDir of ['/workspace/one', '/workspace/two']) {
      await t.mutation(api.workspaces.registerWorkspace, {
        sessionId,
        chatroomId,
        machineId,
        workingDir,
        hostname: 'test-host',
        registeredBy: 'builder',
      });
    }

    const result = await t.mutation(api.agents.requestChatroomAgentOperation, {
      sessionId,
      chatroomId,
      operation: 'stop',
    });

    expect(result.commandIds).toHaveLength(2);
    const queued = await t.query(api.daemon.machineCommandInbox.list, { sessionId, machineId });
    expect(queued.map((row) => row.command)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent.stop', workingDir: '/workspace/one' }),
        expect.objectContaining({ type: 'agent.stop', workingDir: '/workspace/two' }),
      ])
    );
  });
});
