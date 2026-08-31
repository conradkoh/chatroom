import { describe, expect, it, vi } from 'vitest';

import { getFailedAgentRoles, runAgentRestartBatch } from './agentBulkStart';

describe('getFailedAgentRoles', () => {
  it('returns roles for rejected results', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: true },
      { status: 'rejected', reason: new Error('boom') },
    ];

    expect(getFailedAgentRoles(results, ['planner', 'builder'])).toEqual(['builder']);
  });
});

describe('runAgentRestartBatch', () => {
  it('dispatches atomic restart commands with the complete agent config', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const config = {
      machineId: 'machine-1',
      agentType: 'cursor-sdk',
      model: 'cursor/model',
      workingDir: '/workspace',
    } as any;

    await runAgentRestartBatch(
      ['Builder'],
      new Map([['builder', config]]),
      [],
      new Map(),
      'chatroom-1' as any,
      sendCommand,
      vi.fn()
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
      },
    });
  });
  it('prefers the spawned config over a stale persisted config', async () => {
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

    const sendCommand = vi.fn().mockResolvedValue(undefined);
    await runAgentRestartBatch(
      ['Builder'],
      new Map([['builder', persisted]]),
      [running],
      new Map(),
      'chatroom-1' as any,
      sendCommand,
      vi.fn()
    );
    expect(sendCommand.mock.calls[0]?.[0]).toMatchObject({
      machineId: 'machine-2',
      payload: { model: 'current' },
    });
  });

  it('falls back to the live agent view model', async () => {
    const config = { machineId: 'machine-1', agentType: 'cursor-sdk' } as any;
    const view = { machineId: 'machine-1', agentHarness: 'cursor-sdk', model: 'live-model' } as any;

    const sendCommand = vi.fn().mockResolvedValue(undefined);
    await runAgentRestartBatch(
      ['Builder'],
      new Map([['builder', config]]),
      [],
      new Map([['builder', view]]),
      'chatroom-1' as any,
      sendCommand,
      vi.fn()
    );
    expect(sendCommand.mock.calls[0]?.[0]).toMatchObject({ payload: { model: 'live-model' } });
  });

  it('rejects when no machine can be resolved', async () => {
    const config = { agentType: 'cursor-sdk', model: 'model' } as any;
    const onComplete = vi.fn();
    await runAgentRestartBatch(
      ['Builder'],
      new Map([['builder', config]]),
      [],
      new Map(),
      'chatroom-1' as any,
      vi.fn(),
      onComplete
    );
    expect(onComplete).toHaveBeenCalledWith(['Builder']);
  });
});
