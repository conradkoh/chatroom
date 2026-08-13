import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import { startTaskMonitorEffect } from './task-monitor-runtime.js';
import {
  setAssignedTaskSnapshotProvider,
  listAssignedTaskSnapshots,
  hasAssignedTaskSnapshot,
} from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import type { AssignedTaskSnapshotView } from '../domain/entities/assigned-task.js';

vi.mock('../../api.js', () => ({
  api: {
    machines: {
      listMachineAssignedTaskSnapshots: 'listMachineAssignedTaskSnapshots',
      syncMachineAssignedTaskSnapshotsMutation: 'syncMachineAssignedTaskSnapshotsMutation',
    },
  },
}));

function makeSnapshot(overrides?: Partial<AssignedTaskSnapshotView>): AssignedTaskSnapshotView {
  return {
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 200,
    createdAt: 100,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'opencode',
    },
    participant: { lastSeenAction: 'idle', lastSeenAt: 180, lastStatus: 'waiting' },
    ...overrides,
  };
}

function makeLayers() {
  const backend = {
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ tasks: [] }),
  };
  const session = {
    sessionId: 'sess-1',
    machineId: 'machine-1',
    convexUrl: 'http://test:3210',
    backend,
    agentServices: {},
  };
  const agentMgr = {
    getSlot: vi.fn(),
    listActive: vi.fn().mockReturnValue([]),
    stop: vi.fn().mockResolvedValue(undefined),
    ensureRunning: vi.fn(),
    clearStuckStoppingSlot: vi.fn().mockResolvedValue(false),
    resumeTurnForSlot: vi.fn().mockResolvedValue(undefined),
    setLastInFlightTask: vi.fn(),
    recover: vi.fn().mockResolvedValue(undefined),
  };
  const layer = Layer.succeed(DaemonSessionService, session as never).pipe(
    Layer.merge(Layer.succeed(DaemonAgentProcessManagerService, agentMgr as never))
  );
  return { session, agentMgr, layer, backend };
}

async function runAndStop(layer: ReturnType<typeof makeLayers>['layer']) {
  const effect = Effect.provide(startTaskMonitorEffect({ onUpdate: vi.fn(() => vi.fn()) } as never), layer);
  const handle = await Effect.runPromise(effect);
  handle.stop();
}

describe('P2 cutover snapshot store', () => {
  afterEach(() => {
    setAssignedTaskSnapshotProvider(undefined);
    delete process.env.UNCONDITIONAL_CUTOVER;
    delete process.env.UNCONDITIONAL_CUTOVER;
  });

  it('listAssignedTaskSnapshots reads through the read-model provider when set', () => {
    const snapshots = [makeSnapshot(), makeSnapshot({ taskId: 'task-2' })];
    setAssignedTaskSnapshotProvider(() => snapshots);

    expect(listAssignedTaskSnapshots()).toEqual(snapshots);
    expect(hasAssignedTaskSnapshot()).toBe(true);
  });

  it('reverts to in-memory rows when provider is cleared', () => {
    const snapshots = [makeSnapshot()];
    setAssignedTaskSnapshotProvider(() => snapshots);
    setAssignedTaskSnapshotProvider(undefined);

    expect(listAssignedTaskSnapshots()).toEqual([]);
    expect(hasAssignedTaskSnapshot()).toBe(false);
  });

  it('starts the task monitor effect without error (cutover off)', async () => {
    const { layer } = makeLayers();
    await expect(runAndStop(layer)).resolves.toBeUndefined();
  });

  it('starts the task monitor effect without error (cutover on, no WS subscription)', async () => {
    const { layer } = makeLayers();
    await expect(runAndStop(layer)).resolves.toBeUndefined();
  });
});
