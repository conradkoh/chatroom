import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { runRestartOrchestrator, setRestartOrchestratorDb } from './restart-orchestrator.js';
import type { AssignedTaskSnapshotView } from '../domain/entities/assigned-task.js';
import { openDatabase } from '../infrastructure/persistence/open-database.js';
import {
  taskReadModelFromSnapshot,
  upsertTaskReadModel,
} from '../infrastructure/persistence/read-models/tasks.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-restart-orchestrator-'));
  return join(dir, 'events.sqlite');
}

function makeSnapshot(overrides?: Partial<AssignedTaskSnapshotView>): AssignedTaskSnapshotView {
  return {
    taskId: 'task-1',
    chatroomId: 'test-chatroom',
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 200,
    createdAt: 100,
    agentConfig: {
      role: 'builder',
      machineId: 'test-machine',
      agentHarness: 'opencode',
      workingDir: '/tmp/test',
      desiredState: 'running',
      circuitState: 'closed',
    },
    participant: { lastSeenAction: 'idle', lastSeenAt: 180, lastStatus: 'waiting' },
    ...overrides,
  };
}

vi.mock('../../api.js', () => ({
  api: {
    machines: {
      emitRestartPhase: 'emitRestartPhase',
      emitRestartCompleted: 'emitRestartCompleted',
      emitHarnessSessionReady: 'emitHarnessSessionReady',
      syncMachineAssignedTaskSnapshotsMutation: 'syncMachineAssignedTaskSnapshotsMutation',
      listMachineAssignedTaskSnapshots: 'listMachineAssignedTaskSnapshots',
      getAssignedTaskForAction: 'getAssignedTaskForAction',
    },
    participants: {
      join: 'participants.join',
    },
  },
}));

function createMockDeps(overrides?: { spawnSuccess?: boolean; harnessSessionId?: string | null }) {
  const mutationLog: { fn: string; args: Record<string, unknown> }[] = [];
  const backend = {
    mutation: vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
      mutationLog.push({ fn: fn as string, args });
    }),
    query: vi.fn(async () => ({ tasks: [] })),
  };
  const agentMgr = {
    stop: vi.fn().mockResolvedValue(undefined),
    ensureRunning: vi.fn().mockReturnValue(
      Effect.succeed({
        success: overrides?.spawnSuccess ?? true,
        pid: overrides?.spawnSuccess === false ? null : 12345,
        error: overrides?.spawnSuccess === false ? 'spawn failed' : undefined,
      })
    ),
    getSlot: vi
      .fn()
      .mockReturnValue(
        overrides?.harnessSessionId !== undefined
          ? { harnessSessionId: overrides.harnessSessionId }
          : { harnessSessionId: 'test-harness-session' }
      ),
    resumeTurnForSlot: vi.fn(),
    setLastInFlightTask: vi.fn(),
  } as any;

  return {
    deps: {
      session: {
        sessionId: 'test-session',
        machineId: 'test-machine',
        convexUrl: 'http://test:3210',
        backend,
      },
      agentMgr,
    },
    mutationLog,
    agentMgrMock: agentMgr,
    backendMock: backend,
  };
}

describe('runRestartOrchestrator', () => {
  test('success path calls emitRestartCompleted once and does not call emitRestartPhase', async () => {
    const { deps, mutationLog } = createMockDeps();

    await runRestartOrchestrator(deps as any, {
      chatroomId: 'test-chatroom',
      role: 'builder',
      agentHarness: 'opencode',
      model: 'gpt-4',
      workingDir: '/tmp/test',
      correlationId: 'test-correlation',
      wantResume: true,
    });

    const restartCompletedCalls = mutationLog.filter((call) => call.fn === 'emitRestartCompleted');
    expect(restartCompletedCalls).toHaveLength(1);

    const phaseCalls = mutationLog.filter((call) => call.fn === 'emitRestartPhase');
    expect(phaseCalls).toHaveLength(0);
  });

  test('failure path calls emitRestartPhase with failed exactly once', async () => {
    const { deps, mutationLog } = createMockDeps({ spawnSuccess: false });

    await runRestartOrchestrator(deps as any, {
      chatroomId: 'test-chatroom',
      role: 'builder',
      agentHarness: 'opencode',
      model: 'gpt-4',
      workingDir: '/tmp/test',
      correlationId: 'test-correlation',
      wantResume: true,
    });

    const phaseCalls = mutationLog.filter(
      (call) =>
        call.fn === 'emitRestartPhase' && (call.args as { phase?: string }).phase === 'failed'
    );
    expect(phaseCalls).toHaveLength(1);

    const restartCompletedCalls = mutationLog.filter((call) => call.fn === 'emitRestartCompleted');
    expect(restartCompletedCalls).toHaveLength(0);
  });

  test('cutover reads deliverable snapshots from read models, not Convex snapshot query', async () => {
    const db = openDatabase(tempDbPath());
    setRestartOrchestratorDb(db);
    process.env.DAEMON_ORCHESTRATION_P2_CUTOVER = '1';
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot({ status: 'pending' })));
      const { deps, backendMock } = createMockDeps();
      backendMock.query.mockResolvedValue({ tasks: [] });

      await runRestartOrchestrator(deps as any, {
        chatroomId: 'test-chatroom',
        role: 'builder',
        agentHarness: 'opencode',
        model: 'gpt-4',
        workingDir: '/tmp/test',
        correlationId: 'test-correlation',
        wantResume: true,
      });

      expect(backendMock.query).not.toHaveBeenCalledWith(
        'listMachineAssignedTaskSnapshots',
        expect.anything()
      );
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P2_CUTOVER;
      setRestartOrchestratorDb(undefined);
      db.close();
    }
  });
});
