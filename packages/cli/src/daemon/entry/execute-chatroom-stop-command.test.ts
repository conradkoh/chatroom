import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeChatroomStopCommand } from './execute-chatroom-stop-command.js';

const runRoleScopedStop = vi.hoisted(() => vi.fn());
vi.mock('../services/agent-process-service/index.js', () => ({ runRoleScopedStop }));

function target(role: string, workingDir = '/workspace') {
  return { chatroomId: 'room-1', role, workingDir, pid: 42 } as never;
}

function setup(
  options: {
    targets?: unknown[];
    feedRoles?: readonly string[];
    stopResult?: { targets: unknown[]; failures: { error: unknown }[] };
  } = {}
) {
  const events: string[] = [];
  const roleOperations: string[] = [];
  const startAgent = vi.fn();
  const stopAgent = vi.fn();
  const outboxEnqueue = vi.fn(async () => {
    events.push('ack');
  });
  const discoverStopTargets = vi.fn(async () => options.targets ?? []);
  const apm = {
    markStopIntent: vi.fn(),
    markChatroomStopIntent: vi.fn(),
    getConfirmedStopAdapterDeps: vi.fn(() => ({ lifecycleOutbox: { enqueue: outboxEnqueue } })),
    discoverStopTargets,
  } as never;
  const nativeDelivery = {
    prepareRoleRecovery: vi.fn(async () => {
      events.push('prepare');
    }),
    recoverStoppedRole: vi.fn(async ({ role }: { role: string }) => {
      events.push('recover');
      roleOperations.push(`recover:${role}`);
    }),
  };
  const taskService = {
    listMachineTaskRolesForChatroom: vi.fn(async () => options.feedRoles ?? []),
  };
  const runSerializedForAgent = vi.fn(async (_key, _options, operation) =>
    operation({ startAgent, stopAgent }, { signal: new AbortController().signal })
  );
  runRoleScopedStop.mockImplementation(async ({ role }: { role: string }) => {
    events.push('stop');
    roleOperations.push(`stop:${role}`);
    return options.stopResult ?? { targets: [], failures: [] };
  });
  return {
    events,
    roleOperations,
    startAgent,
    outboxEnqueue,
    discoverStopTargets,
    apm,
    nativeDelivery,
    taskService,
    runSerializedForAgent,
    run: (extra: Record<string, unknown> = {}) =>
      executeChatroomStopCommand({
        apm,
        chatroomId: 'room-1',
        commandId: 'command-1',
        runSerializedForAgent,
        nativeDelivery,
        taskService,
        ...extra,
      } as never),
  };
}

describe('executeChatroomStopCommand', () => {
  beforeEach(() => {
    runRoleScopedStop.mockReset();
  });

  it('orders delivery fencing, confirmed stop, explicit recovery, and acknowledgement', async () => {
    const state = setup({ targets: [target('Builder')] });
    await state.run();
    expect(state.events).toEqual(['prepare', 'stop', 'recover', 'ack']);
    expect(state.nativeDelivery.recoverStoppedRole).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      mode: 'explicit',
    });
    expect(state.roleOperations).toEqual(['stop:builder', 'recover:builder']);
    expect(state.startAgent).not.toHaveBeenCalled();
  });

  it('recovers an explicitly requested role even when there is no local PID', async () => {
    const state = setup();
    await state.run({ role: 'NoPid' });
    expect(state.nativeDelivery.prepareRoleRecovery).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'nopid',
    });
    expect(state.nativeDelivery.recoverStoppedRole).toHaveBeenCalledTimes(1);
    expect(state.roleOperations).toEqual(['stop:nopid', 'recover:nopid']);
    expect(state.startAgent).not.toHaveBeenCalled();
    expect(state.taskService.listMachineTaskRolesForChatroom).not.toHaveBeenCalled();
    expect(state.outboxEnqueue).toHaveBeenCalledTimes(1);
  });

  it('uses deduplicated backend roles and discovered roles for a full chatroom stop', async () => {
    const state = setup({
      targets: [target('Builder'), target('Reviewer')],
      feedRoles: ['BUILDER', 'tester'],
    });
    await state.run();
    expect(state.nativeDelivery.recoverStoppedRole).toHaveBeenCalledTimes(3);
    for (const role of ['builder', 'reviewer', 'tester']) {
      expect(state.roleOperations.indexOf(`stop:${role}`)).toBeLessThan(
        state.roleOperations.indexOf(`recover:${role}`)
      );
    }
    expect(state.startAgent).not.toHaveBeenCalled();
    for (const role of ['builder', 'reviewer', 'tester'])
      expect(state.nativeDelivery.recoverStoppedRole).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role,
        mode: 'explicit',
      });
    expect(state.taskService.listMachineTaskRolesForChatroom).toHaveBeenCalledOnce();
    expect(state.outboxEnqueue).toHaveBeenCalledOnce();
  });

  it('limits roles for explicit role and working directory targeting', async () => {
    const state = setup({
      targets: [
        target('Builder', '/selected'),
        target('Builder', '/other'),
        target('Reviewer', '/selected'),
      ],
      feedRoles: ['ignored'],
    });
    // The post-stop discovery sees only a live process outside the selected scope.
    state.discoverStopTargets
      .mockResolvedValueOnce([
        target('Builder', '/selected'),
        target('Builder', '/other'),
        target('Reviewer', '/selected'),
      ])
      .mockResolvedValueOnce([target('Builder', '/other')]);
    await expect(state.run({ role: 'BUILDER', workingDir: '/selected' })).rejects.toThrow(
      'chatroom stop failed'
    );
    expect(state.nativeDelivery.recoverStoppedRole).not.toHaveBeenCalled();
    expect(state.roleOperations).toEqual(['stop:builder']);
    expect(state.startAgent).not.toHaveBeenCalled();
    expect(runRoleScopedStop).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'builder', workingDir: '/selected' })
    );
    expect(state.taskService.listMachineTaskRolesForChatroom).not.toHaveBeenCalled();
    expect(state.outboxEnqueue).not.toHaveBeenCalled();
    expect(state.runSerializedForAgent).toHaveBeenCalledOnce();
  });

  it('rejects partial process stop failure without releasing backend tasks or acknowledging', async () => {
    const failure = new Error('pid did not exit');
    const state = setup({
      targets: [target('Builder')],
      stopResult: { targets: [], failures: [{ error: failure }] },
    });
    await expect(state.run()).rejects.toThrow('chatroom stop failed');
    expect(state.nativeDelivery.prepareRoleRecovery).toHaveBeenCalledOnce();
    expect(state.nativeDelivery.recoverStoppedRole).not.toHaveBeenCalled();
    expect(state.outboxEnqueue).not.toHaveBeenCalled();
  });

  it('rejects recovery failure without acknowledging, then retry succeeds', async () => {
    const state = setup({ targets: [target('Builder')] });
    state.nativeDelivery.recoverStoppedRole
      .mockRejectedValueOnce(new Error('backend release failed'))
      .mockImplementationOnce(async () => {
        state.events.push('recover');
      });
    await expect(state.run()).rejects.toThrow('chatroom stop failed');
    expect(state.outboxEnqueue).not.toHaveBeenCalled();
    state.events.length = 0;
    await state.run();
    expect(state.events).toEqual(['prepare', 'stop', 'recover', 'ack']);
    expect(state.outboxEnqueue).toHaveBeenCalledOnce();
  });
});
