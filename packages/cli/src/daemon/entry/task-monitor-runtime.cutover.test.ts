import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonAgentProcessManagerService, DaemonSessionService } from './daemon-services.js';
import { setTaskMonitorReadModelDb, startTaskMonitorEffect } from './task-monitor-runtime.js';
import {
  setAssignedTaskSnapshotProvider,
  listAssignedTaskSnapshots,
  hasAssignedTaskSnapshot,
} from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import { openDatabase } from '../infrastructure/persistence/open-database.js';
import { getAgentReadModel } from '../infrastructure/persistence/read-models/agents.js';
import { getParticipantReadModel } from '../infrastructure/persistence/read-models/participants.js';
import { listSnapshotViewsFromReadModels } from '../infrastructure/persistence/read-models/task-snapshot-adapter.js';
import { listTaskReadModelsForMachine } from '../infrastructure/persistence/read-models/tasks.js';

vi.mock('../../api.js', () => ({
  api: {
    machines: {
      listMachineAssignedTaskSnapshots: 'listMachineAssignedTaskSnapshots',
      syncMachineAssignedTaskSnapshotsMutation: 'syncMachineAssignedTaskSnapshotsMutation',
    },
  },
}));

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-task-monitor-cutover-'));
  return join(dir, 'events.sqlite');
}

function rawSnapshotRow(overrides?: Record<string, unknown>) {
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
      model: 'gpt-4o',
      workingDir: '/workspace',
      spawnedAgentPid: 42,
      desiredState: 'running',
      circuitState: 'closed',
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

function makeWsClient() {
  let updateCb: ((result: unknown) => void) | undefined;
  const onUpdate = vi.fn((_fn: unknown, _args: unknown, cb: (result: unknown) => void) => {
    updateCb = cb;
    return () => {};
  });
  return {
    onUpdate,
    emitUpdate: (result: unknown) => updateCb?.(result),
  };
}

async function runEffect(
  layer: ReturnType<typeof makeLayers>['layer'],
  wsClient: ReturnType<typeof makeWsClient>
) {
  return Effect.runPromise(Effect.provide(startTaskMonitorEffect(wsClient as never), layer));
}

describe('P2 cutover snapshot store', () => {
  afterEach(() => {
    setAssignedTaskSnapshotProvider(undefined);
    setTaskMonitorReadModelDb(undefined);
    delete process.env.DAEMON_ORCHESTRATION_P2;
    delete process.env.DAEMON_ORCHESTRATION_P2_CUTOVER;
  });

  it('P2 off / cutover off subscribes to the snapshot WS and never uses local cutover authority', async () => {
    const { layer } = makeLayers();
    const wsClient = makeWsClient();
    const handle = await runEffect(layer, wsClient);

    // WS subscription is authoritative — no local read-model/provider path is set up.
    expect(wsClient.onUpdate).toHaveBeenCalled();
    expect(hasAssignedTaskSnapshot()).toBe(false);

    handle.stop();
  });

  it('P2 on / cutover off retains WS authority while shadow-syncing local read models', async () => {
    const db = openDatabase(tempDbPath());
    setTaskMonitorReadModelDb(db);
    process.env.DAEMON_ORCHESTRATION_P2 = '1';
    const { layer } = makeLayers();
    const wsClient = makeWsClient();
    const handle = await runEffect(layer, wsClient);

    // Snapshot WS remains the authority (still subscribed).
    expect(wsClient.onUpdate).toHaveBeenCalled();

    // A snapshot push shadow-syncs task, participant, and agent read models.
    wsClient.emitUpdate({ tasks: [rawSnapshotRow()] });

    expect(listTaskReadModelsForMachine(db, 'machine-1')).toHaveLength(1);
    expect(getParticipantReadModel(db, 'room-1', 'builder')).toMatchObject({
      chatroomId: 'room-1',
      role: 'builder',
      turnPhase: 'waiting',
    });
    expect(getAgentReadModel(db, 'machine-1', 'builder')).toMatchObject({
      machineId: 'machine-1',
      role: 'builder',
      pid: 42,
    });

    handle.stop();
    db.close();
  });

  it('P2 cutover on does not subscribe to the snapshot WS and reads local read models', async () => {
    const db = openDatabase(tempDbPath());
    setTaskMonitorReadModelDb(db);
    setAssignedTaskSnapshotProvider(() => listSnapshotViewsFromReadModels(db, 'machine-1'));
    process.env.DAEMON_ORCHESTRATION_P2 = '1';
    process.env.DAEMON_ORCHESTRATION_P2_CUTOVER = '1';
    const { layer, backend } = makeLayers();
    backend.query.mockResolvedValue({ tasks: [rawSnapshotRow()] });
    const wsClient = makeWsClient();

    const handle = await runEffect(layer, wsClient);

    // No snapshot WS subscription in cutover; Convex is queried once to seed read models.
    expect(wsClient.onUpdate).not.toHaveBeenCalled();
    expect(backend.query).toHaveBeenCalledWith(
      'listMachineAssignedTaskSnapshots',
      expect.anything()
    );

    // Refresh is async fire-and-forget; wait for local read models to land.
    await vi.waitFor(() => {
      expect(listTaskReadModelsForMachine(db, 'machine-1')).toHaveLength(1);
    });
    expect(getParticipantReadModel(db, 'room-1', 'builder')).not.toBeNull();
    expect(getAgentReadModel(db, 'machine-1', 'builder')).not.toBeNull();

    // The snapshot store reads through the read-model provider (cutover authority).
    expect(listAssignedTaskSnapshots().map((s) => s.taskId)).toContain('task-1');

    handle.stop();
    db.close();
  });
});
