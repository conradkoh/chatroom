import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapMachineAssignedTaskSnapshots,
  runInboxLoopWithRestart,
  startTaskInboxEffect,
} from './task-inbox-runtime.js';
import { runTaskInbox } from '../infrastructure/inbox/task.js';

const processTasksUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runOperationalInbox = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchMachineAgentOperationalStatus = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const ackMachineOperationalSignals = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchMachineAssignedTaskSnapshots = vi.hoisted(() =>
  vi.fn(async (deps: unknown) => {
    const result = await (
      deps as {
        backend: { query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown> };
      }
    ).backend.query('listMachineAssignedTaskSnapshots', {});
    return (result as { tasks?: unknown[] }).tasks ?? [];
  })
);
const createInboxStateStore = vi.hoisted(() => vi.fn());
const resolveInboxDbPath = vi.hoisted(() => vi.fn().mockReturnValue('/tmp/test-inbox.sqlite'));

vi.mock('../infrastructure/inbox/task.js', () => ({ runTaskInbox: vi.fn() }));
vi.mock('./native-delivery/task-delivery-processor.js', () => ({ processTasksUpdate }));
vi.mock('../infrastructure/agent-operational/operational-inbox.js', () => ({
  runOperationalInbox,
  operationalSignalCursorAt: (timestamp: number) =>
    `${String(Math.max(0, Math.floor(timestamp))).padStart(16, '0')}:`,
}));
vi.mock('../infrastructure/agent-operational/fetch-machine-agent-operational-status.js', () => ({
  fetchMachineAgentOperationalStatus,
}));
vi.mock('../infrastructure/agent-operational/ack-machine-operational-signals.js', () => ({
  ackMachineOperationalSignals,
}));
vi.mock('../infrastructure/inbox/fetch-machine-assigned-task-snapshots.js', () => ({
  fetchMachineAssignedTaskSnapshots,
}));
vi.mock('../infrastructure/inbox/index.js', () => ({
  createInboxStateStore,
  resolveInboxDbPath,
}));

beforeEach(() => {
  vi.mocked(runTaskInbox).mockReset().mockResolvedValue(undefined);
  runOperationalInbox.mockReset().mockResolvedValue(undefined);
  fetchMachineAgentOperationalStatus.mockReset().mockResolvedValue([]);
  ackMachineOperationalSignals.mockReset().mockResolvedValue(undefined);
  createInboxStateStore.mockReset();
  processTasksUpdate.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

function makeInboxStore(persistedOperational: { afterSignalKey: string } | null = null): {
  get: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const store = {
    get: vi.fn((key: { inboxType: string }) =>
      key.inboxType === 'operational' && persistedOperational
        ? { state: persistedOperational }
        : null
    ),
    save: vi.fn(),
    close: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  };
  createInboxStateStore.mockReturnValue(store);
  return store;
}

async function startTaskInboxForTest(tasks: unknown[] = []) {
  const { Effect, Layer } = await import('effect');
  const { AgentLifecycleOutboxService, DaemonAgentProcessManagerService, DaemonSessionService } =
    await import('./daemon-services.js');
  const session = {
    sessionId: 'session-1',
    machineId: 'machine-1',
    convexUrl: 'https://example.com',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ tasks }),
    },
    agentServices: new Map(),
  };
  const layers = Layer.mergeAll(
    Layer.succeed(DaemonSessionService, session as never),
    Layer.succeed(DaemonAgentProcessManagerService, {} as never),
    Layer.succeed(AgentLifecycleOutboxService, {
      enqueue: () => Effect.succeed({ success: true }),
      stopAll: () => Effect.void,
    })
  );
  let operationalHandler: ((update: never) => Promise<void>) | undefined;
  runOperationalInbox.mockImplementation(async (_options, handler) => {
    operationalHandler = handler;
  });
  const handle = await Effect.runPromise(
    startTaskInboxEffect({} as never).pipe(Effect.provide(layers))
  );
  return { handle, operationalHandler: () => operationalHandler! };
}

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

describe('startTaskInboxEffect operational bootstrap', () => {
  const baseline = '0000000000001234:';

  it('persists and acknowledges the fresh bootstrap baseline', async () => {
    const store = makeInboxStore();
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { handle } = await startTaskInboxForTest();
    await vi.waitFor(() => expect(ackMachineOperationalSignals).toHaveBeenCalledOnce());

    expect(store.save).toHaveBeenCalledWith(
      { inboxType: 'operational', scopeKey: 'machine-1' },
      { afterSignalKey: baseline }
    );
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      baseline
    );
    expect(runOperationalInbox.mock.calls[0]?.[0]).toMatchObject({
      initialAfterSignalKey: baseline,
    });
    handle.stop();
  });

  it('does not persist or acknowledge when fresh bootstrap fails', async () => {
    const store = makeInboxStore();
    fetchMachineAgentOperationalStatus.mockRejectedValueOnce(new Error('bootstrap failed'));
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { handle } = await startTaskInboxForTest();

    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineOperationalSignals).not.toHaveBeenCalled();
    expect(runOperationalInbox.mock.calls[0]?.[0]).toMatchObject({
      initialAfterSignalKey: baseline,
    });
    handle.stop();
  });

  it('acknowledges a persisted cursor even when bootstrap fails', async () => {
    const persistedKey = '0000000000000099:room:builder';
    const store = makeInboxStore({ afterSignalKey: persistedKey });
    fetchMachineAgentOperationalStatus.mockRejectedValueOnce(new Error('bootstrap failed'));

    const { handle } = await startTaskInboxForTest();
    await vi.waitFor(() => expect(ackMachineOperationalSignals).toHaveBeenCalledOnce());

    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      persistedKey
    );
    expect(runOperationalInbox.mock.calls[0]?.[0]).toMatchObject({
      initialAfterSignalKey: persistedKey,
    });
    handle.stop();
  });

  it('orders live processing, cursor persistence, and acknowledgement', async () => {
    const store = makeInboxStore();
    fetchMachineAssignedTaskSnapshots.mockResolvedValueOnce([
      {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 1,
        createdAt: 1,
        agentConfig: {
          role: 'builder',
          machineId: 'machine-1',
          agentHarness: 'cursor-sdk',
          workingDir: '/tmp',
        },
      },
    ]);
    const { handle, operationalHandler } = await startTaskInboxForTest();
    await vi.waitFor(() => expect(runOperationalInbox).toHaveBeenCalledOnce());
    processTasksUpdate.mockClear();
    ackMachineOperationalSignals.mockClear();
    store.save.mockClear();

    const order: string[] = [];
    processTasksUpdate.mockImplementation(async () => {
      order.push('process');
    });
    store.save.mockImplementation(() => {
      order.push('save');
    });
    ackMachineOperationalSignals.mockImplementation(async () => {
      order.push('ack');
    });

    await operationalHandler()({
      rows: [
        {
          chatroomId: 'room-1',
          role: 'builder',
          operationalState: 'running',
          isAlive: true,
          isRunning: true,
          daemonConnected: true,
          revisionKey: 'revision-1',
        },
      ],
      removed: [],
      throughSignalKey: '0000000000000001:room-1:builder',
    } as never);

    expect(order).toEqual(['process', 'save', 'ack']);
    handle.stop();
  });

  it('does not acknowledge when live processing fails', async () => {
    const store = makeInboxStore();
    fetchMachineAssignedTaskSnapshots.mockResolvedValueOnce([
      {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 1,
        createdAt: 1,
        agentConfig: {
          role: 'builder',
          machineId: 'machine-1',
          agentHarness: 'cursor-sdk',
          workingDir: '/tmp',
        },
      },
    ]);
    const { handle, operationalHandler } = await startTaskInboxForTest();
    processTasksUpdate.mockClear();
    ackMachineOperationalSignals.mockClear();
    store.save.mockClear();
    processTasksUpdate.mockRejectedValueOnce(new Error('processing failed'));

    await expect(
      operationalHandler()({
        rows: [
          {
            chatroomId: 'room-1',
            role: 'builder',
            operationalState: 'running',
            isAlive: true,
            isRunning: true,
            daemonConnected: true,
            revisionKey: 'revision-1',
          },
        ],
        removed: [],
        throughSignalKey: 'key',
      } as never)
    ).rejects.toThrow('processing failed');
    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineOperationalSignals).not.toHaveBeenCalled();
    handle.stop();
  });

  it('completes live processing when acknowledgement fails', async () => {
    const store = makeInboxStore();
    fetchMachineAssignedTaskSnapshots.mockResolvedValueOnce([
      {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 1,
        createdAt: 1,
        agentConfig: {
          role: 'builder',
          machineId: 'machine-1',
          agentHarness: 'cursor-sdk',
          workingDir: '/tmp',
        },
      },
    ]);
    const { handle, operationalHandler } = await startTaskInboxForTest();
    processTasksUpdate.mockClear();
    ackMachineOperationalSignals.mockClear();
    store.save.mockClear();
    ackMachineOperationalSignals.mockRejectedValueOnce(new Error('ack failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      operationalHandler()({
        rows: [
          {
            chatroomId: 'room-1',
            role: 'builder',
            operationalState: 'running',
            isAlive: true,
            isRunning: true,
            daemonConnected: true,
            revisionKey: 'revision-1',
          },
        ],
        removed: [],
        throughSignalKey: 'key',
      } as never)
    ).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[OperationalInbox] signal cleanup failed:',
      expect.any(Error)
    );
    warn.mockRestore();
    handle.stop();
  });
});
