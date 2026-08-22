import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapMachineAssignedTaskSnapshots,
  runInboxLoopWithRestart,
} from './task-inbox-runtime.js';
import { runTaskInbox } from '../infrastructure/inbox/task.js';

const processTasksUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../infrastructure/inbox/task.js', () => ({ runTaskInbox: vi.fn() }));
vi.mock('./native-delivery/task-delivery-processor.js', () => ({ processTasksUpdate }));

beforeEach(() => vi.mocked(runTaskInbox).mockReset());

describe('bootstrapMachineAssignedTaskSnapshots', () => {
  it('delivers pending snapshots via processTasksUpdate on restart bootstrap', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({
      tasks: [
        {
          taskId: 'task-1',
          chatroomId: 'room-1',
          status: 'pending',
          assignedTo: 'builder',
          updatedAt: 100,
          createdAt: 100,
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
            spawnedAgentPid: 42,
            desiredState: 'running',
          },
          participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
        },
      ],
    });
    await bootstrapMachineAssignedTaskSnapshots({
      sessionDeps: { sessionId: 'session-1', backend: { mutation, query } } as never,
      runtime: {} as never,
      effectContext: {} as never,
      cooldown: {} as never,
      agentMgr: {} as never,
      machineId: 'machine-1',
    });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(processTasksUpdate).toHaveBeenCalledOnce();
    expect(processTasksUpdate.mock.calls[0]?.[6]).toBe('bootstrap');
  });

  it('syncs and does not deliver when no snapshots exist', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockResolvedValue({ tasks: [] });
    await bootstrapMachineAssignedTaskSnapshots({
      sessionDeps: { sessionId: 'session-1', backend: { mutation, query } } as never,
      runtime: undefined as never,
      effectContext: undefined as never,
      cooldown: undefined as never,
      agentMgr: undefined as never,
      machineId: 'machine-1',
    });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledOnce();
  });
});

describe('runInboxLoopWithRestart', () => {
  it('retries transient errors and stops on AbortError', async () => {
    vi.mocked(runTaskInbox)
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(Object.assign(new Error('stopped'), { name: 'AbortError' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
    const promise = runInboxLoopWithRestart({} as never, vi.fn(), () => false);
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
    expect(runTaskInbox).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('does not restart on AbortError', async () => {
    vi.mocked(runTaskInbox).mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    await runInboxLoopWithRestart({} as never, vi.fn(), () => false);
    expect(runTaskInbox).toHaveBeenCalledOnce();
  });
});
