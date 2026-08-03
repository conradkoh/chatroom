import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { runRestartOrchestrator } from './restart-orchestrator.js';
import { createNoopEventRecorder } from '../../../infrastructure/event-store/index.js';

vi.mock('../../../api.js', () => ({
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
        eventRecorder: createNoopEventRecorder('test-machine'),
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
});
