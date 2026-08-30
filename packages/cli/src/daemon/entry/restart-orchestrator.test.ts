import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { runRestartOrchestrator } from './restart-orchestrator.js';

vi.mock('../../api.js', () => ({
  api: {
    machines: {
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
  const auditLog: Record<string, unknown>[] = [];
  const logEvent = vi.fn(async (event: Record<string, unknown>) => {
    auditLog.push(event);
  });
  const backend = {
    mutation: vi.fn(async () => undefined),
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
        logEvent,
        backend,
      },
      agentMgr,
    },
    auditLog,
    agentMgrMock: agentMgr,
    backendMock: backend,
  };
}

describe('runRestartOrchestrator', () => {
  test('success path emits ordered phases and completes once', async () => {
    const { deps, auditLog } = createMockDeps();

    await runRestartOrchestrator(deps as any, {
      chatroomId: 'test-chatroom',
      role: 'builder',
      agentHarness: 'opencode',
      model: 'gpt-4',
      workingDir: '/tmp/test',
      correlationId: 'test-correlation',
      wantResume: false,
    });

    const restartCompleted = auditLog.filter((event) => event.type === 'agent.restartCompleted');
    expect(restartCompleted).toHaveLength(1);

    const phaseEvents = auditLog.filter((event) => event.type === 'agent.restartPhase');
    expect(phaseEvents.map((event) => event.phase)).toEqual([
      'reset',
      'spawn',
      'await_session',
      'ready',
      'deliver',
      'completed',
    ]);
    expect(phaseEvents.every((event) => event.correlationId === 'test-correlation')).toBe(true);
  });

  test('failure path logs restartPhase failed exactly once', async () => {
    const { deps, auditLog } = createMockDeps({ spawnSuccess: false });

    await runRestartOrchestrator(deps as any, {
      chatroomId: 'test-chatroom',
      role: 'builder',
      agentHarness: 'opencode',
      model: 'gpt-4',
      workingDir: '/tmp/test',
      correlationId: 'test-correlation',
      wantResume: false,
    });

    const failedPhases = auditLog.filter(
      (event) => event.type === 'agent.restartPhase' && event.phase === 'failed'
    );
    expect(failedPhases).toHaveLength(1);

    const restartCompleted = auditLog.filter((event) => event.type === 'agent.restartCompleted');
    expect(restartCompleted).toHaveLength(0);
  });
});
