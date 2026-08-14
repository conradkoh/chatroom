import { describe, expect, it, vi } from 'vitest';

import {
  getFailedAgentRoles,
  resolveRestartConfigForRole,
  restartAgentsForRoles,
} from './agentBulkStart';

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
      [],
      new Map(),
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

describe('resolveRestartConfigForRole', () => {
  it('prefers the spawned config over a stale persisted config', () => {
    const persisted = {
      role: 'builder',
      machineId: 'machine-1',
      agentType: 'cursor-sdk',
      model: 'old',
    } as any;
    const running = {
      ...persisted,
      role: 'builder',
      machineId: 'machine-2',
      model: 'current',
      spawnedAgentPid: 42,
    } as any;

    expect(
      resolveRestartConfigForRole('Builder', new Map([['builder', persisted]]), [running])
    ).toMatchObject({ machineId: 'machine-2', model: 'current' });
  });

  it('falls back to the live agent view model', () => {
    const config = { machineId: 'machine-1', agentType: 'cursor-sdk' } as any;
    const view = { machineId: 'machine-1', agentHarness: 'cursor-sdk', model: 'live-model' } as any;

    expect(
      resolveRestartConfigForRole('Builder', new Map([['builder', config]]), [], view)
    ).toMatchObject({ model: 'live-model' });
  });

  it('returns null when no machine can be resolved', () => {
    const config = { agentType: 'cursor-sdk', model: 'model' } as any;
    expect(resolveRestartConfigForRole('Builder', new Map([['builder', config]]), [])).toBeNull();
  });
});
