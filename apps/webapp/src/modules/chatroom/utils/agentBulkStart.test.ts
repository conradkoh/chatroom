import { describe, expect, it, vi } from 'vitest';

import { getFailedAgentRoles, restartAgentsForRoles } from './agentBulkStart';

describe('getFailedAgentRoles', () => {
  it('returns roles for rejected results', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: true },
      { status: 'rejected', reason: new Error('boom') },
    ];

    expect(getFailedAgentRoles(results, ['planner', 'builder'])).toEqual(['builder']);
  });
});

describe('restartAgentsForRoles', () => {
  it('dispatches atomic restart commands with the complete persisted config', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const config = {
      machineId: 'machine-1',
      agentType: 'cursor-sdk',
      model: 'cursor/model',
      workingDir: '/workspace',
      wantResume: true,
    } as any;

    await restartAgentsForRoles(
      ['Builder'],
      new Map([['builder', config]]),
      'chatroom-1' as any,
      sendCommand
    );

    expect(sendCommand).toHaveBeenCalledWith({
      machineId: 'machine-1',
      type: 'restart-agent',
      payload: {
        chatroomId: 'chatroom-1',
        role: 'Builder',
        model: 'cursor/model',
        agentHarness: 'cursor-sdk',
        workingDir: '/workspace',
        wantResume: true,
      },
    });
  });
});
