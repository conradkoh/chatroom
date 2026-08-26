import { beforeEach, describe, expect, test, vi } from 'vitest';

const runExactTargetsStop = vi.fn();
const finalizeScopedStopExecution = vi.fn();

vi.mock('../infrastructure/agent-process-manager/execute-stop-targets-adapter.js', () => ({
  runExactTargetsStop,
}));
vi.mock('./finalize-scoped-stop-execution.js', () => ({
  finalizeScopedStopExecution,
}));

import { api } from '../../api.js';
import { executeScopedStopForCommand } from './execute-scoped-stop-command.js';

function setup() {
  const backend = { mutation: vi.fn() };
  const apm = {
    getConfirmedStopAdapterDeps: vi.fn(() => ({})),
    syncSlotsAfterScopedStop: vi.fn(),
  };
  backend.mutation.mockResolvedValue({
    shouldExecute: true,
    targets: [{ targetKey: 'target', role: 'builder', pid: 42 }],
  });
  return { backend, apm };
}

describe('executeScopedStopForCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runExactTargetsStop.mockResolvedValue({ targets: [], failures: [] });
  });

  test('finalizes and syncs when target execution throws', async () => {
    const { backend, apm } = setup();
    const error = new Error('executor failed');
    runExactTargetsStop.mockRejectedValue(error);

    const summary = await executeScopedStopForCommand({
      sessionId: 'session',
      machineId: 'machine',
      backend,
      apm: apm as never,
      stopCommandId: 'stop',
      chatroomId: 'room',
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
      inboxCommandId: 'inbox',
    });

    expect(summary.failedCount).toBe(1);
    expect(finalizeScopedStopExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionError: error })
    );
    expect(apm.syncSlotsAfterScopedStop).toHaveBeenCalledWith({ targets: [], failures: [] });
  });

  test('passes successful results to finalization', async () => {
    const { backend, apm } = setup();
    const result = {
      targets: [{ target: { targetKey: 'target' }, outcome: { kind: 'stopped' } }],
      failures: [],
    };
    runExactTargetsStop.mockResolvedValue(result);

    const summary = await executeScopedStopForCommand({
      sessionId: 'session',
      machineId: 'machine',
      backend,
      apm: apm as never,
      stopCommandId: 'stop',
      chatroomId: 'room',
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
      inboxCommandId: 'inbox',
    });

    expect(summary).toEqual({ stoppedCount: 1, failedCount: 0, executionError: undefined });
    expect(finalizeScopedStopExecution).toHaveBeenCalledWith(expect.objectContaining({ result }));
  });

  test('does not execute a command rejected by begin', async () => {
    const { backend, apm } = setup();
    backend.mutation.mockResolvedValue({ shouldExecute: false, targets: [] });

    await expect(
      executeScopedStopForCommand({
        sessionId: 'session',
        machineId: 'machine',
        backend,
        apm: apm as never,
        stopCommandId: 'stop',
        chatroomId: 'room',
        scope: { kind: 'chatroom' },
        reason: 'user.stop',
        inboxCommandId: 'inbox',
      })
    ).resolves.toEqual({ stoppedCount: 0, failedCount: 0 });
    expect(runExactTargetsStop).not.toHaveBeenCalled();
    expect(finalizeScopedStopExecution).not.toHaveBeenCalled();
    expect(backend.mutation).toHaveBeenCalledWith(
      api.agentStops.beginMachineExecution,
      expect.anything()
    );
  });
});
