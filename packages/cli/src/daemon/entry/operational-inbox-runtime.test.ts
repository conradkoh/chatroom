import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startOperationalInboxEffect } from './operational-inbox-runtime.js';
import { refreshWorkspaceMembership } from './workspace-membership-refresh-registry.js';
import { type AssignedTaskSnapshotView } from '../domain/entities/assigned-task.js';
import type { MachineAgentOperationalRow } from '../infrastructure/agent-operational/operational-signal-feeds.js';
import { runTaskInbox } from '../infrastructure/inbox/task.js';
import {
  NativeDeliveryService,
  type NativeDeliveryServiceDependencies,
} from '../services/service-interfaces.js';

const processTasksUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runOperationalInbox = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchMachineAgentOperationalStatus = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const ackMachineSignalMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
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
vi.mock('../services/task-service/service/native-delivery/task-delivery-processor.js', () => ({
  processTasksUpdate,
}));
vi.mock('../infrastructure/agent-operational/operational-inbox.js', () => ({
  runOperationalInbox,
  operationalSignalCursorAt: (timestamp: number) =>
    `${String(Math.max(0, Math.floor(timestamp))).padStart(16, '0')}:`,
}));
vi.mock('../infrastructure/agent-operational/fetch-machine-agent-operational-status.js', () => ({
  fetchMachineAgentOperationalStatus,
}));
vi.mock('../infrastructure/agent-operational/ack-machine-operational-signals.js', () => ({
  ackMachineSignal: ackMachineSignalMock,
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
  inboxType: 'operational:agent-operational',
  scopeKey: COMPOSITE_SCOPE_KEY('machine-1', 'room-1'),
};
const OPERATIONAL_SCOPE_ROOM_2 = {
  inboxType: 'operational:agent-operational',
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

function agentOperationalRunCalls() {
  return runOperationalInbox.mock.calls.filter(
    (call) => call[0].feed?.kind === 'agent-operational' || !call[0].feed
  );
}

function agentOperationalAckCalls() {
  return ackMachineSignalMock.mock.calls.filter(
    (call) => call[4] === 'agent-operational' || call[4] === undefined
  );
}

beforeEach(() => {
  vi.mocked(runTaskInbox).mockReset().mockResolvedValue(undefined);
  runOperationalInbox.mockReset().mockResolvedValue(undefined);
  fetchMachineAgentOperationalStatus.mockReset().mockResolvedValue([]);
  ackMachineSignalMock.mockReset().mockResolvedValue(undefined);
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
        (key.inboxType.startsWith('operational:') || key.inboxType === 'task') &&
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

type StartOperationalInboxOptions = {
  tasks?: unknown[];
  workspaces?: { chatroomId: string }[];
  bootstrapRows?: MachineAgentOperationalRow[];
  operationalInboxImpl?: (
    options: Parameters<typeof runOperationalInbox>[0],
    onUpdate: Parameters<typeof runOperationalInbox>[1]
  ) => Promise<void>;
};

async function startOperationalInboxForTest(options: StartOperationalInboxOptions = {}): Promise<{
  handle: { stop: () => void };
  workspaceQuery: ReturnType<typeof vi.fn>;
  operationalHandlers: () => ((update: never) => Promise<void>)[];
  taskInboxHandlers: () => Map<string, (update: never) => Promise<void>>;
}> {
  const { Effect, Layer } = await import('effect');
  const {
    AgentLifecycleOutboxService,
    DaemonAgentProcessManagerCommandService,
    DaemonAgentProcessManagerService,
    DaemonSessionService,
  } = await import('./daemon-services.js');
  const backendQuery = vi.fn().mockResolvedValue({ tasks: options.tasks ?? [] });
  const workspaceQuery = vi.fn().mockResolvedValue(options.workspaces ?? []);
  const agentProcessManager = {
    subscribeAgentTurnEnded: vi.fn(() => () => undefined),
    subscribeAgentStarted: vi.fn(() => () => undefined),
    subscribeAgentSessionLost: vi.fn(() => () => undefined),
  };
  const session = {
    sessionId: 'session-1',
    machineId: 'machine-1',
    convexUrl: 'https://example.com',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: backendQuery,
    },
    agentServices: new Map(),
  };
  const taskRows = [...(options.tasks ?? [])] as AssignedTaskSnapshotView[];
  const taskSnapshotState = {
    replace: vi.fn((rows: readonly AssignedTaskSnapshotView[]) => {
      taskRows.splice(0, taskRows.length, ...rows);
    }),
    applySignalPage: vi.fn((_signals: unknown, rows: readonly AssignedTaskSnapshotView[]) => {
      taskRows.splice(0, taskRows.length, ...rows);
    }),
    listForRole: vi.fn((chatroomId: string, role: string) =>
      taskRows.filter(
        (row) =>
          row.chatroomId === chatroomId && row.agentConfig.role.toLowerCase() === role.toLowerCase()
      )
    ),
    listAll: vi.fn(() => taskRows),
  };
  const taskListeners = new Set<(notification: unknown) => Promise<void> | void>();
  const registeredTaskRooms = new Set<string>();
  const taskRoomControllers = new Map<string, AbortController>();
  const taskService: Record<string, any> = {
    taskSnapshotState,
    subscribe: vi.fn((listener: (notification: unknown) => Promise<void> | void) => {
      taskListeners.add(listener);
      return () => taskListeners.delete(listener);
    }),
    startTaskInbox: vi.fn(async () => {
      for (const chatroomId of new Set(taskRows.map((row) => row.chatroomId))) {
        await taskService.registerTaskChatroom(chatroomId);
      }
    }),
    registerTaskChatroom: vi.fn(async (chatroomId: string) => {
      if (registeredTaskRooms.has(chatroomId)) return;
      registeredTaskRooms.add(chatroomId);
      taskRoomControllers.set(chatroomId, new AbortController());
      const key = { inboxType: 'task', scopeKey: COMPOSITE_SCOPE_KEY('machine-1', chatroomId) };
      const persisted = createInboxStateStore.mock.results[0]?.value?.get?.(key);
      const cursor = persisted?.state?.afterSignalKey ?? BASELINE;
      if (!persisted)
        createInboxStateStore.mock.results[0]?.value?.save?.(key, { afterSignalKey: cursor });
      await runTaskInbox(
        {
          chatroomId,
          initialAfterSignalKey: cursor,
          signal: taskRoomControllers.get(chatroomId)?.signal,
        } as never,
        async (update) => {
          taskSnapshotState.applySignalPage(update.signals, update.snapshots);
          for (const listener of taskListeners) await listener({ kind: 'inbox', update });
          createInboxStateStore.mock.results[0]?.value?.save?.(key, {
            afterSignalKey: update.throughSignalKey,
          });
        }
      );
    }),
    unregisterTaskChatroom: vi.fn((chatroomId: string) => {
      taskRoomControllers.get(chatroomId)?.abort();
      taskRoomControllers.delete(chatroomId);
      registeredTaskRooms.delete(chatroomId);
    }),
    stopTaskInbox: vi.fn(() => {
      for (const controller of taskRoomControllers.values()) controller.abort();
    }),
    isNativeHarness: vi.fn(() => true),
    snapshotRequestsNativeColdSession: vi.fn(() => false),
    explainNativeDeliveryBlock: vi.fn(() => null),
    deliverNativeTask: vi.fn().mockResolvedValue(undefined),
  };
  taskService.createNativeDeliveryService = (
    deliveryDeps: Omit<NativeDeliveryServiceDependencies, 'taskService' | 'taskSnapshotState'>
  ) => {
    const service = new NativeDeliveryService({
      ...deliveryDeps,
      taskSnapshotState: taskSnapshotState as never,
      taskService: taskService as never,
    });
    service.startPeriodicReconciliation();
    return service;
  };
  Object.assign(session, { taskService });
  const layers = Layer.mergeAll(
    Layer.succeed(DaemonSessionService, session as never),
    Layer.succeed(DaemonAgentProcessManagerService, agentProcessManager as never),
    Layer.succeed(DaemonAgentProcessManagerCommandService, {
      runSerializedForAgent: async (_key: never, operation: (ops: never) => Promise<unknown>) =>
        operation({} as never),
    } as never),
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
        if (_options.feed?.kind === 'agent-operational' || !_options.feed) {
          operationalHandlers.push(handler);
        }
      })
  );
  vi.mocked(runTaskInbox).mockImplementation(async (taskOptions, handler) => {
    taskInboxHandlers.set(taskOptions.chatroomId, handler);
  });
  const handle = await Effect.runPromise(
    startOperationalInboxEffect({ query: workspaceQuery } as never).pipe(Effect.provide(layers))
  );
  return {
    handle,
    workspaceQuery,
    operationalHandlers: () => operationalHandlers,
    taskInboxHandlers: () => taskInboxHandlers,
  };
}

describe('startOperationalInboxEffect operational room supervisor', () => {
  it('saves a fresh operational and task baseline per discovered room and acks with matching room ids', async () => {
    const store = makeInboxStore();
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { handle } = await startOperationalInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
    });
    await vi.waitFor(() => expect(agentOperationalAckCalls()).toHaveLength(2));

    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_1, {
      afterSignalKey: BASELINE,
    });
    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_2, {
      afterSignalKey: BASELINE,
    });
    expect(store.save).toHaveBeenCalledWith(TASK_SCOPE_ROOM_1, { afterSignalKey: BASELINE });
    expect(store.save).toHaveBeenCalledWith(TASK_SCOPE_ROOM_2, { afterSignalKey: BASELINE });
    expect(ackMachineSignalMock).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      BASELINE,
      'agent-operational'
    );
    expect(ackMachineSignalMock).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-2',
      BASELINE,
      'agent-operational'
    );
    expect(agentOperationalRunCalls().map((call) => call[0].chatroomId)).toEqual([
      'room-1',
      'room-2',
    ]);
    expect(agentOperationalRunCalls()[0]?.[0]).toMatchObject({
      initialAfterSignalKey: BASELINE,
    });
    expect(agentOperationalRunCalls()[1]?.[0]).toMatchObject({
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

    const { handle } = await startOperationalInboxForTest({ bootstrapRows: [opRow('room-1')] });
    await vi.waitFor(() => expect(agentOperationalAckCalls()).toHaveLength(1));

    expect(store.save).not.toHaveBeenCalled();
    expect(ackMachineSignalMock).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      persistedKey,
      'agent-operational'
    );
    expect(agentOperationalRunCalls()[0]?.[0]).toMatchObject({
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

  it('does not start operational watchers when operational bootstrap fails', async () => {
    const persistedKey = '0000000000000099:room:builder';
    const store = makeInboxStore({
      [COMPOSITE_SCOPE_KEY('machine-1', 'room-1')]: { afterSignalKey: persistedKey },
    });
    fetchMachineAgentOperationalStatus.mockRejectedValueOnce(new Error('bootstrap failed'));
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const { handle } = await startOperationalInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMachineAgentOperationalStatus).toHaveBeenCalledTimes(1);
    expect(store.save).not.toHaveBeenCalled();
    expect(agentOperationalAckCalls()).toHaveLength(0);
    expect(runOperationalInbox).not.toHaveBeenCalled();
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

    const { handle } = await startOperationalInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
    });

    const opCalls = agentOperationalRunCalls();
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
    expect(agentOperationalRunCalls()).toHaveLength(2);
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(2);

    handle.stop();
    vi.useRealTimers();
  });

  it('keeps process -> save -> ack ordering with the room-scoped cursor', async () => {
    const store = makeInboxStore();
    const { handle, operationalHandlers } = await startOperationalInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [opRow('room-1')],
    });
    await vi.waitFor(() => expect(agentOperationalRunCalls()).toHaveLength(1));
    processTasksUpdate.mockClear();
    ackMachineSignalMock.mockClear();
    store.save.mockClear();

    const order: string[] = [];
    processTasksUpdate.mockImplementation(async () => {
      order.push('process');
    });
    store.save.mockImplementation(() => {
      order.push('save');
    });
    ackMachineSignalMock.mockImplementation(async () => {
      order.push('ack');
    });

    await operationalHandlers()[0]({
      chatroomId: 'room-1',
      rows: [updatedOpRow('room-1')],
      throughSignalKey: 'key-1',
    } as never);

    expect(order).toEqual(['process', 'save', 'ack']);
    expect(processTasksUpdate.mock.calls[0]?.[7]).toBe('operational-signal');
    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_1, {
      afterSignalKey: 'key-1',
    });
    expect(ackMachineSignalMock).toHaveBeenCalledWith(
      expect.anything(),
      'machine-1',
      'room-1',
      'key-1',
      'agent-operational'
    );
    handle.stop();
  });

  it('task handler delivers then persists the room composite task cursor', async () => {
    const store = makeInboxStore();
    const { handle, taskInboxHandlers } = await startOperationalInboxForTest({
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
    const { handle, operationalHandlers } = await startOperationalInboxForTest({
      tasks: [taskSnapshot('task-1', 'room-1')],
      bootstrapRows: [opRow('room-1')],
    });
    await vi.waitFor(() => expect(agentOperationalRunCalls()).toHaveLength(1));
    processTasksUpdate.mockClear();
    ackMachineSignalMock.mockClear();
    store.save.mockClear();
    processTasksUpdate.mockRejectedValueOnce(new Error('processing failed'));

    await expect(
      operationalHandlers()[0]({
        chatroomId: 'room-1',
        rows: [updatedOpRow('room-1')],
        throughSignalKey: 'key-1',
      } as never)
    ).rejects.toThrow('processing failed');
    expect(store.save).not.toHaveBeenCalled();
    expect(agentOperationalAckCalls()).toHaveLength(0);
    handle.stop();
  });

  it('keeps the cursor saved and logs cleanup failure when ack fails', async () => {
    const store = makeInboxStore();
    const { handle, operationalHandlers } = await startOperationalInboxForTest({
      bootstrapRows: [opRow('room-1')],
    });
    await vi.waitFor(() => expect(agentOperationalRunCalls()).toHaveLength(1));
    processTasksUpdate.mockClear();
    ackMachineSignalMock.mockClear();
    store.save.mockClear();
    ackMachineSignalMock.mockRejectedValueOnce(new Error('ack failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      operationalHandlers()[0]({
        chatroomId: 'room-1',
        rows: [opRow('room-1')],
        throughSignalKey: 'key-1',
      } as never)
    ).resolves.toBeUndefined();
    expect(store.save).toHaveBeenCalledWith(OPERATIONAL_SCOPE_ROOM_1, {
      afterSignalKey: 'key-1',
    });
    expect(warn).toHaveBeenCalledWith(
      '[OperationalInbox kind=agent-operational room=room-1] signal cleanup failed:',
      expect.any(Error)
    );
    warn.mockRestore();
    handle.stop();
  });

  it('workspace membership nudge starts room watchers and delivers its first task', async () => {
    const store = makeInboxStore();
    vi.useFakeTimers();

    const { handle, workspaceQuery, taskInboxHandlers } = await startOperationalInboxForTest({
      bootstrapRows: [],
      tasks: [],
    });

    expect(runOperationalInbox).not.toHaveBeenCalled();
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(0);

    // A workspace membership nudge surfaces room-2 for the first time.
    fetchMachineAgentOperationalStatus.mockResolvedValue([opRow('room-2')]);
    workspaceQuery.mockResolvedValueOnce([{ chatroomId: 'room-2' }]);
    await refreshWorkspaceMembership();

    expect(agentOperationalRunCalls().map((call) => call[0].chatroomId)).toEqual(['room-2']);
    const taskCalls = vi.mocked(runTaskInbox).mock.calls;
    expect(taskCalls.map((call) => call[0].chatroomId)).toEqual(['room-2']);

    // A second nudge re-discovers room-2; no duplicate watchers are started.
    workspaceQuery.mockResolvedValueOnce([{ chatroomId: 'room-2' }]);
    await refreshWorkspaceMembership();
    expect(agentOperationalRunCalls()).toHaveLength(1);
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(1);

    // Removal stops the room watcher; re-adding it starts a fresh pair.
    workspaceQuery.mockResolvedValueOnce([]);
    await refreshWorkspaceMembership();
    workspaceQuery.mockResolvedValueOnce([{ chatroomId: 'room-2' }]);
    await refreshWorkspaceMembership();
    expect(agentOperationalRunCalls()).toHaveLength(2);
    expect(vi.mocked(runTaskInbox).mock.calls).toHaveLength(2);

    const fetchCountAfterNudges = fetchMachineAgentOperationalStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMachineAgentOperationalStatus).toHaveBeenCalledTimes(fetchCountAfterNudges);

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
    expect(processTasksUpdate.mock.calls[0]?.[7]).toBe('task-signal');
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

    const { handle } = await startOperationalInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
      operationalInboxImpl: reconnectableInboxImpl,
    });

    expect(calls.filter((call) => call.chatroomId === 'room-1')).toHaveLength(2);
    expect(calls.filter((call) => call.chatroomId === 'room-2')).toHaveLength(2);
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
    expect(calls.filter((call) => call.chatroomId === 'room-1')).toHaveLength(3);
    expect(calls.filter((call) => call.chatroomId === 'room-2')).toHaveLength(2);
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

    const { handle, operationalHandlers } = await startOperationalInboxForTest({
      bootstrapRows: [opRow('room-1'), opRow('room-2')],
      tasks: [taskSnapshot('task-1', 'room-1'), taskSnapshot('task-2', 'room-2')],
    });
    processTasksUpdate.mockImplementation(() => gate);
    const [handler1, handler2] = operationalHandlers();
    const first = handler1({
      chatroomId: 'room-1',
      rows: [updatedOpRow('room-1')],
      throughSignalKey: 'k1',
    } as never);
    const second = handler2({
      chatroomId: 'room-2',
      rows: [updatedOpRow('room-2')],
      throughSignalKey: 'k2',
    } as never);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(processTasksUpdate.mock.calls.some((call) => call[7] === 'periodic-reconcile')).toBe(
      false
    );

    release?.();
    await Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(processTasksUpdate.mock.calls.some((call) => call[7] === 'periodic-reconcile')).toBe(
      true
    );

    handle.stop();
    vi.useRealTimers();
  });
});
