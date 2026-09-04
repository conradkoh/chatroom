import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapMachineAssignedTaskSnapshots,
  runInboxLoopWithRestart,
  startTaskInboxEffect,
} from './task-inbox-runtime.js';
import { type AssignedTaskSnapshotView } from '../domain/entities/assigned-task.js';
import type { MachineAgentOperationalRow } from '../infrastructure/agent-operational/agent-operational-read-model.js';
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

vi.mock('../infrastructure/inbox/task.js', () => ({
  runTaskInbox: vi.fn(),
  taskSignalCursorAt: (timestamp: number) =>
    `${String(Math.max(0, Math.floor(timestamp))).padStart(16, '0')}:`,
}));
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

const COMPOSITE_SCOPE_KEY = (machineId: string, chatroomId: string) =>
  JSON.stringify([machineId, chatroomId]);

function opRow(chatroomId: string): MachineAgentOperationalRow {
  return {
    chatroomId,
    role: 'builder',
    operationalState: 'running',
    isAlive: true,
    isRunning: true,
    daemonConnected: true,
    revisionKey: `revision-${chatroomId}`,
  };
}

/** A changed revision of a room's operational row — drives a signal-page change vs bootstrap. */
function updatedOpRow(chatroomId: string): MachineAgentOperationalRow {
  return { ...opRow(chatroomId), revisionKey: 'revision-changed' };
}

function taskSnapshot(taskId: string, chatroomId: string): AssignedTaskSnapshotView {
  return {
    taskId,
    chatroomId,
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 100,
    createdAt: 100,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp',
    },
  } as AssignedTaskSnapshotView;
}

const OPERATIONAL_SCOPE_ROOM_1 = {
  inboxType: 'operational',
  scopeKey: COMPOSITE_SCOPE_KEY('machine-1', 'room-1'),
};
const OPERATIONAL_SCOPE_ROOM_2 = {
  inboxType: 'operational',
  scopeKey: COMPOSITE_SCOPE_KEY('machine-1', 'room-2'),
};
const TASK_SCOPE_ROOM_1 = {
  inboxType: 'task',
  scopeKey: COMPOSITE_SCOPE_KEY('machine-1', 'room-1'),
};
const TASK_SCOPE_ROOM_2 = {
  inboxType: 'task',
  scopeKey: COMPOSITE_SCOPE_KEY('machine-1', 'room-2'),
};
const BASELINE = '0000000000001234:';

beforeEach(() => {
  vi.mocked(runTaskInbox).mockReset().mockResolvedValue(undefined);
  runOperationalInbox.mockReset().mockResolvedValue(undefined);
  fetchMachineAgentOperationalStatus.mockReset().mockResolvedValue([]);
  ackMachineOperationalSignals.mockReset().mockResolvedValue(undefined);
  createInboxStateStore.mockReset();
  processTasksUpdate.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

function makeInboxStore(persistedRooms: Record<string, { afterSignalKey: string }> = {}): {
  get: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const store = {
    get: vi.fn((key: { inboxType: string; scopeKey: string }) => {
      if (
        (key.inboxType === 'operational' || key.inboxType === 'task') &&
        persistedRooms[key.scopeKey]
      ) {
        return { state: persistedRooms[key.scopeKey] };
      }
      return null;
    }),
    save: vi.fn(),
    close: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  };
  createInboxStateStore.mockReturnValue(store);
  return store;
}

type StartTaskInboxOptions = {
  tasks?: unknown[];
  bootstrapRows?: MachineAgentOperationalRow[];
  operationalInboxImpl?: (
    options: Parameters<typeof runOperationalInbox>[0],
    onUpdate: Parameters<typeof runOperationalInbox>[1]
  ) => Promise<void>;
};

async function startTaskInboxForTest(options: StartTaskInboxOptions = {}): Promise<{
  handle: { stop: () => void };
  operationalHandlers: () => ((update: never) => Promise<void>)[];
  taskInboxHandlers: () => Map<string, (update: never) => Promise<void>>;
}> {
  const { Effect, Layer } = await import('effect');
  const { AgentLifecycleOutboxService, DaemonAgentProcessManagerService, DaemonSessionService } =
    await import('./daemon-services.js');
  const session = {
    sessionId: 'session-1',
    machineId: 'machine-1',
    convexUrl: 'https://example.com',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ tasks: options.tasks ?? [] }),
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
  fetchMachineAgentOperationalStatus.mockResolvedValue(options.bootstrapRows ?? []);
  const operationalHandlers: ((update: never) => Promise<void>)[] = [];
  const taskInboxHandlers = new Map<string, (update: never) => Promise<void>>();
  runOperationalInbox.mockImplementation(
    options.operationalInboxImpl ??
      (async (_options, handler) => {
        operationalHandlers.push(handler);
      })
  );
  vi.mocked(runTaskInbox).mockImplementation(async (taskOptions, handler) => {
    taskInboxHandlers.set(taskOptions.chatroomId, handler);
  });
  const handle = await Effect.runPromise(
    startTaskInboxEffect({} as never).pipe(Effect.provide(layers))
  );
  return {
    handle,
    operationalHandlers: () => operationalHandlers,
    taskInboxHandlers: () => taskInboxHandlers,
  };
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

  it('invokes the discovery callback with task chatroom ids before delivery', async () => {
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
          agentConfig: { chatroomId: 0, role: 'builder', machineId: 'machine-1' },
        },
        {
          taskId: 'task-2',
          chatroomId: 'room-1',
          status: 'pending',
          assignedTo: 'builder',
          updatedAt: 100,
          createdAt: 100,
          agentConfig: { chatroomId: 0, role: 'builder', machineId: 'machine-1' },
        },
      ],
    });
    const onDiscoveredChatrooms = vi.fn().mockResolvedValue(undefined);
    const order: string[] = [];
    onDiscoveredChatrooms.mockImplementation(async () => {
      order.push('discover');
    });
    processTasksUpdate.mockImplementation(async () => {
      order.push('deliver');
    });
    await bootstrapMachineAssignedTaskSnapshots({
      sessionDeps: { sessionId: 'session-1', backend: { mutation, query } } as never,
      runtime: {} as never,
      effectContext: {} as never,
      cooldown: {} as never,
      agentMgr: {} as never,
      machineId: 'machine-1',
      onDiscoveredChatrooms,
    });
    expect(onDiscoveredChatrooms).toHaveBeenCalledWith(['room-1']);
    expect(order).toEqual(['discover', 'deliver']);
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

describe('startTaskInboxEffect operational room supervisor', () => {
  it('saves a fresh operational and task baseline per discovered room and acks with matching room ids', async () => {
    const store = makeInboxStore();
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { handle } = await startTaskInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
    });
    await vi.waitFor(() => expect(ackMachineOperationalSignals).toHaveBeenCalledTimes(2));

    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_1, {
      afterSignalKey: BASELINE,
    });
    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_2, {
      afterSignalKey: BASELINE,
    });
    expect(store.save).toHaveBeenCalledWith(TASK_SCOPE_ROOM_1, { afterSignalKey: BASELINE });
    expect(store.save).toHaveBeenCalledWith(TASK_SCOPE_ROOM_2, { afterSignalKey: BASELINE });
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      BASELINE
    );
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-2',
      BASELINE
    );
    expect(runOperationalInbox.mock.calls.map((call) => call[0].chatroomId)).toEqual([
      'room-1',
      'room-2',
    ]);
    expect(runOperationalInbox.mock.calls[0]?.[0]).toMatchObject({
      initialAfterSignalKey: BASELINE,
    });
    expect(runOperationalInbox.mock.calls[1]?.[0]).toMatchObject({
      initialAfterSignalKey: BASELINE,
    });
    const taskCalls = vi.mocked(runTaskInbox).mock.calls;
    expect(taskCalls.map((call) => call[0].chatroomId).sort()).toEqual(['room-1', 'room-2']);
    expect(taskCalls.every((call) => call[0].initialAfterSignalKey === BASELINE)).toBe(true);
    handle.stop();
    vi.restoreAllMocks();
  });

  it('reads and acks a persisted room cursor without touching the legacy machine key', async () => {
    const persistedKey = '0000000000000099:room:builder';
    const store = makeInboxStore({
      [COMPOSITE_SCOPE_KEY('machine-1', 'room-1')]: { afterSignalKey: persistedKey },
    });

    const { handle } = await startTaskInboxForTest({ bootstrapRows: [opRow('room-1')] });
    await vi.waitFor(() => expect(ackMachineOperationalSignals).toHaveBeenCalledOnce());

    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      persistedKey
    );
    expect(runOperationalInbox.mock.calls[0]?.[0]).toMatchObject({
      chatroomId: 'room-1',
      initialAfterSignalKey: persistedKey,
    });
    const legacyReads = store.get.mock.calls.filter(
      ([key]) => key.inboxType === 'operational' && key.scopeKey === 'machine-1'
    );
    expect(legacyReads).toHaveLength(0);
    const legacyWrites = store.save.mock.calls.filter(
      ([key]) => key.inboxType === 'operational' && key.scopeKey === 'machine-1'
    );
    expect(legacyWrites).toHaveLength(0);
    const legacyTaskReads = store.get.mock.calls.filter(
      ([key]) => key.inboxType === 'task' && key.scopeKey === 'machine-1'
    );
    expect(legacyTaskReads).toHaveLength(0);
    const legacyTaskWrites = store.save.mock.calls.filter(
      ([key]) => key.inboxType === 'task' && key.scopeKey === 'machine-1'
    );
    expect(legacyTaskWrites).toHaveLength(0);
    const taskCalls = vi.mocked(runTaskInbox).mock.calls;
    expect(taskCalls).toHaveLength(1);
    expect(taskCalls[0]?.[0]).toMatchObject({
      chatroomId: 'room-1',
      initialAfterSignalKey: persistedKey,
    });
    handle.stop();
  });

  it('does not save or ack fresh baselines when bootstrap fails but still acks persisted cursors', async () => {
    const persistedKey = '0000000000000099:room:builder';
    const store = makeInboxStore({
      [COMPOSITE_SCOPE_KEY('machine-1', 'room-1')]: { afterSignalKey: persistedKey },
    });
    fetchMachineAgentOperationalStatus.mockRejectedValueOnce(new Error('bootstrap failed'));
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { handle } = await startTaskInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [],
    });
    await vi.waitFor(() => expect(ackMachineOperationalSignals).toHaveBeenCalledOnce());

    expect(fetchMachineAgentOperationalStatus).toHaveBeenCalledTimes(2);
    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      persistedKey
    );
    expect(runOperationalInbox.mock.calls[0]?.[0]).toMatchObject({
      chatroomId: 'room-1',
      initialAfterSignalKey: persistedKey,
    });
    handle.stop();
    vi.restoreAllMocks();
  });

  it('starts independent operational and task watchers per room and deduplicates repeated discovery', async () => {
    const persistedRooms = {
      [COMPOSITE_SCOPE_KEY('machine-1', 'room-1')]: { afterSignalKey: 'cursor-1' },
      [COMPOSITE_SCOPE_KEY('machine-1', 'room-2')]: { afterSignalKey: 'cursor-2' },
    };
    makeInboxStore(persistedRooms);
    vi.useFakeTimers();

    const { handle } = await startTaskInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
    });

    const opCalls = runOperationalInbox.mock.calls;
    expect(opCalls.map((call) => call[0].chatroomId).sort()).toEqual(['room-1', 'room-2']);
    expect(opCalls.find((call) => call[0].chatroomId === 'room-1')?.[0]).toMatchObject({
      initialAfterSignalKey: 'cursor-1',
    });
    expect(opCalls.find((call) => call[0].chatroomId === 'room-2')?.[0]).toMatchObject({
      initialAfterSignalKey: 'cursor-2',
    });

    const taskCalls = vi.mocked(runTaskInbox).mock.calls;
    expect(taskCalls.map((call) => call[0].chatroomId).sort()).toEqual(['room-1', 'room-2']);
    expect(taskCalls.find((call) => call[0].chatroomId === 'room-1')?.[0]).toMatchObject({
      initialAfterSignalKey: 'cursor-1',
    });
    expect(taskCalls.find((call) => call[0].chatroomId === 'room-2')?.[0]).toMatchObject({
      initialAfterSignalKey: 'cursor-2',
    });

    // Membership refresh re-discovers the same rooms; watchers must not duplicate.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runOperationalInbox).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(2);

    handle.stop();
    vi.useRealTimers();
  });

  it('keeps process -> save -> ack ordering with the room-scoped cursor', async () => {
    const store = makeInboxStore();
    const { handle, operationalHandlers } = await startTaskInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [opRow('room-1')],
    });
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

    await operationalHandlers()[0]({
      chatroomId: 'room-1',
      rows: [updatedOpRow('room-1')],
      removed: [],
      throughSignalKey: 'key-1',
    } as never);

    expect(order).toEqual(['process', 'save', 'ack']);
    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_1, {
      afterSignalKey: 'key-1',
    });
    expect(ackMachineOperationalSignals).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      'key-1'
    );
    handle.stop();
  });

  it('task handler delivers then persists the room composite task cursor', async () => {
    const store = makeInboxStore();
    const { handle, taskInboxHandlers } = await startTaskInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [opRow('room-1')],
    });
    const roomOneTaskHandler = taskInboxHandlers().get('room-1');
    expect(roomOneTaskHandler).toBeDefined();

    const order: string[] = [];
    processTasksUpdate.mockImplementation(async () => {
      order.push('deliver');
    });
    store.save.mockImplementation(() => {
      order.push('save');
    });

    await roomOneTaskHandler?.({
      signals: [
        {
          chatroomId: 'room-1',
          taskId: 'task-1',
          targetRole: 'builder',
          taskStatus: 'pending',
          signalKey: 'k1',
          taskUpdatedAt: 100,
        },
      ],
      snapshots: [taskSnapshot('task-1', 'room-1')],
      afterSignalKey: '',
      throughSignalKey: 'k1',
    } as never);

    expect(order).toEqual(['deliver', 'save']);
    expect(store.save).toHaveBeenCalledWith(TASK_SCOPE_ROOM_1, { afterSignalKey: 'k1' });
    handle.stop();
  });

  it('does not save or ack a room when its processing fails', async () => {
    const store = makeInboxStore();
    const { handle, operationalHandlers } = await startTaskInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [opRow('room-1')],
    });
    await vi.waitFor(() => expect(runOperationalInbox).toHaveBeenCalledOnce());
    processTasksUpdate.mockClear();
    ackMachineOperationalSignals.mockClear();
    store.save.mockClear();
    processTasksUpdate.mockRejectedValueOnce(new Error('processing failed'));

    await expect(
      operationalHandlers()[0]({
        chatroomId: 'room-1',
        rows: [updatedOpRow('room-1')],
        removed: [],
        throughSignalKey: 'key-1',
      } as never)
    ).rejects.toThrow('processing failed');
    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineOperationalSignals).not.toHaveBeenCalled();
    handle.stop();
  });

  it('keeps the cursor saved and logs cleanup failure when ack fails', async () => {
    const store = makeInboxStore();
    const { handle, operationalHandlers } = await startTaskInboxForTest({
      bootstrapRows: [opRow('room-1')],
    });
    await vi.waitFor(() => expect(runOperationalInbox).toHaveBeenCalledOnce());
    processTasksUpdate.mockClear();
    ackMachineOperationalSignals.mockClear();
    store.save.mockClear();
    ackMachineOperationalSignals.mockRejectedValueOnce(new Error('ack failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      operationalHandlers()[0]({
        chatroomId: 'room-1',
        rows: [opRow('room-1')],
        removed: [],
        throughSignalKey: 'key-1',
      } as never)
    ).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_1, {
      afterSignalKey: 'key-1',
    });
    expect(warn).toHaveBeenCalledWith(
      '[OperationalInbox room=room-1] signal cleanup failed:',
      expect.any(Error)
    );
    warn.mockRestore();
    handle.stop();
  });

  it('later discovery via reconcile refresh starts room watchers and delivers its first task', async () => {
    const store = makeInboxStore();
    vi.useFakeTimers();

    const { handle, taskInboxHandlers } = await startTaskInboxForTest({
      bootstrapRows: [],
      tasks: [],
    });

    expect(runOperationalInbox).not.toHaveBeenCalled();
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(0);

    // Periodic room-membership refresh surfaces room-2 for the first time.
    fetchMachineAgentOperationalStatus.mockResolvedValue([opRow('room-2')]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(runOperationalInbox.mock.calls.map((call) => call[0].chatroomId)).toEqual(['room-2']);
    const taskCalls = vi.mocked(runTaskInbox).mock.calls;
    expect(taskCalls.map((call) => call[0].chatroomId)).toEqual(['room-2']);

    // A second refresh re-discovers room-2; no duplicate watchers are started.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runOperationalInbox).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(1);

    // Deliver room-2's first task through its per-room handler.
    const roomTwoTaskHandler = taskInboxHandlers().get('room-2');
    expect(roomTwoTaskHandler).toBeDefined();
    processTasksUpdate.mockClear();
    await roomTwoTaskHandler?.({
      signals: [
        {
          chatroomId: 'room-2',
          taskId: 'task-1',
          targetRole: 'builder',
          taskStatus: 'pending',
          signalKey: 'k1',
          taskUpdatedAt: 100,
        },
      ],
      snapshots: [taskSnapshot('task-1', 'room-2')],
      afterSignalKey: '',
      throughSignalKey: 'k1',
    } as never);

    expect(processTasksUpdate).toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledWith(TASK_SCOPE_ROOM_2, { afterSignalKey: 'k1' });

    handle.stop();
    vi.useRealTimers();
  });

  it('isolates one room restart from another and aborts all watchers on shutdown', async () => {
    makeInboxStore();
    vi.useFakeTimers();
    const calls: { chatroomId: string; signal: AbortSignal }[] = [];
    const reconnectableInboxImpl = async (
      options: Parameters<typeof runOperationalInbox>[0]
    ): Promise<void> => {
      calls.push({ chatroomId: options.chatroomId, signal: options.signal! });
      const roomCalls = calls.filter((call) => call.chatroomId === options.chatroomId).length;
      if (options.chatroomId === 'room-1' && roomCalls === 1) {
        throw new Error('transient room error');
      }
      return new Promise<void>(() => {});
    };
    runOperationalInbox.mockImplementation(reconnectableInboxImpl);

    const { handle } = await startTaskInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
      operationalInboxImpl: reconnectableInboxImpl,
    });

    expect(calls.filter((call) => call.chatroomId === 'room-1')).toHaveLength(1);
    expect(calls.filter((call) => call.chatroomId === 'room-2')).toHaveLength(1);
    expect(calls.find((call) => call.chatroomId === 'room-2')?.signal.aborted).toBe(false);

    const taskCalls = vi.mocked(runTaskInbox).mock.calls;
    expect(taskCalls).toHaveLength(2);
    const taskSignals = taskCalls.map((call) => call[0].signal!);
    const roomTwoTaskSignal = taskSignals.find(
      (_signal, index) => taskCalls[index][0].chatroomId === 'room-2'
    );
    expect(roomTwoTaskSignal?.aborted).toBe(false);

    // Room-1 restarts after the backoff; room-2 is untouched.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.filter((call) => call.chatroomId === 'room-1')).toHaveLength(2);
    expect(calls.filter((call) => call.chatroomId === 'room-2')).toHaveLength(1);
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(2);

    handle.stop();
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
    expect(taskSignals.every((signal) => signal.aborted)).toBe(true);
    vi.useRealTimers();
  });

  it('keeps periodic reconcile quiet while any room handler is active', async () => {
    makeInboxStore();
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { handle, operationalHandlers } = await startTaskInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
      tasks: [taskSnapshot('task-1', 'room-1'), taskSnapshot('task-2', 'room-2')],
    });
    processTasksUpdate.mockImplementation(() => gate);
    const [handler1, handler2] = operationalHandlers();
    const first = handler1({
      chatroomId: 'room-1',
      rows: [updatedOpRow('room-1')],
      removed: [],
      throughSignalKey: 'k1',
    } as never);
    const second = handler2({
      chatroomId: 'room-2',
      rows: [updatedOpRow('room-2')],
      removed: [],
      throughSignalKey: 'k2',
    } as never);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(processTasksUpdate.mock.calls.some((call) => call[6] === 'periodic-reconcile')).toBe(
      false
    );

    release?.();
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(processTasksUpdate.mock.calls.some((call) => call[6] === 'periodic-reconcile')).toBe(
      true
    );

    handle.stop();
    vi.useRealTimers();
  });
});
