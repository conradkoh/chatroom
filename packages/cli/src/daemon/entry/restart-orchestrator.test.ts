import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { runRestartOrchestrator } from './restart-orchestrator.js';
import type {
  EnsureRunningOpts,
  StopOpts,
} from '../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';

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

function createMockDeps(overrides?: {
  spawnSuccess?: boolean | undefined;
  harnessSessionId?: string | null | undefined;
}) {
  const auditLog: Record<string, unknown>[] = [];
  const logEvent = vi.fn(async (event: Record<string, unknown>) => {
    auditLog.push(event);
  });
  const backend = {
    mutation: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ tasks: [] })),
  };
  const agentMgr = {
    stop: vi.fn().mockResolvedValue({ success: true }),
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
      runSerializedForAgent: vi.fn(async (_key, _options, operation) =>
        operation(
          {
            stopAgent: async (input: StopOpts) => {
              const result = await agentMgr.stop(input);
              return result ?? { success: true };
            },
            startAgent: async (input: EnsureRunningOpts) =>
              Effect.runPromise(agentMgr.ensureRunning(input)),
          },
          { signal: new AbortController().signal }
        )
      ),
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
