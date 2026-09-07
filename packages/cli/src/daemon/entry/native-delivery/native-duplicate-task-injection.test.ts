/**
 * Regression: signal + presence reconcile must not re-inject the same task in one harness session.
 *
 * PR #916 replaced per-task ledger dedup with a per-role mutex only. Acknowledged tasks stay
 * eligible for delivery until readTask moves them in_progress, so a second reconcile pass
 * (e.g. presence update right after native:task-injected) could call resumeTurn twice.
 */

import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { NativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { operationalRow } from '../../infrastructure/agent-operational/test-support.js';
import type { DaemonAgentProcessManagerServiceShape } from '../daemon-services.js';

const HARNESS_SESSION_ID = 'harness-dedupe-session';
const TASK_ID = 'task_dup_1';
const CHATROOM_ID = 'room_dup';
const ROLE = 'planner';

function makeAcknowledgedRow() {
  return {
    taskId: TASK_ID as never,
    chatroomId: CHATROOM_ID as never,
    status: 'acknowledged' as const,
    assignedTo: ROLE,
    updatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    agentConfig: {
      role: ROLE,
      machineId: 'machine_dup',
      agentHarness: 'cursor-sdk',
      workingDir: '/test',
      spawnedAgentPid: 42_001,
      desiredState: 'running' as const,
    },
    participant: {
      lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
      lastSeenAt: 1_700_000_000_000,
      lastStatus: 'task.acknowledged',
    },
  };
}

function makeAgentMgr(resumeTurnForSlot: ReturnType<typeof vi.fn>) {
  return {
    getSlot: vi.fn().mockReturnValue({
      state: 'running',
      pid: 42_001,
      harnessSessionId: HARNESS_SESSION_ID,
      nativeTurnPhase: 'idle' as const,
    }),
    resumeTurnForSlot,
  } as unknown as DaemonAgentProcessManagerServiceShape;
}

describe('native duplicate task injection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('second reconcile pass skips already-delivered task in same harness session', async () => {
    const resumeTurnForSlot = vi.fn().mockReturnValue(Effect.succeed(undefined));
    const agentMgr = makeAgentMgr(resumeTurnForSlot);
    const row = makeAcknowledgedRow();
    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const backendQuery = vi.fn(async (_fn: unknown, args: unknown) => {
      if (args && typeof args === 'object' && 'chatroomId' in args) {
        return { fullCliOutput: 'TASK PROMPT' };
      }
      return { ...row, taskContent: '## Goal\nDuplicate injection test' };
    });

    const coordinator = new NativeTaskDeliveryCoordinator();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const operationalModel = new AgentOperationalReadModel();
    operationalModel.replace([operationalRow(CHATROOM_ID, ROLE)]);
    const activeTaskIds = new Set<string>();

    const reconcileParams = {
      tasks: [row],
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      runSerializedForAgent: vi.fn(async (_key, _options, operation) =>
        operation(
          {
            startAgent: async () => ({ success: true }),
            stopAgent: async () => ({ success: true }),
          } as never,
          { signal: new AbortController().signal }
        )
      ) as never,
      sessionDeps: {
        sessionId: 'session_dup',
        machineId: 'machine_dup',
        logEvent: async () => undefined,
        convexUrl: 'http://test:3210',
        backend: { mutation: backendMutation, query: backendQuery },
      },
      machineId: 'machine_dup',
      lifecycleOutbox: { enqueue: async () => undefined },
      operationalModel,
      isTaskActive: ({ taskId }: { taskId: string }) => activeTaskIds.has(taskId),
      onTaskDelivered: ({ taskId }: { taskId: string }) => activeTaskIds.add(taskId),
    };

    coordinator.reconcileAssignedTasks(reconcileParams);
    await vi.waitFor(() => {
      expect(activeTaskIds.has(TASK_ID)).toBe(true);
    });

    resumeTurnForSlot.mockClear();
    logSpy.mockClear();

    coordinator.reconcileAssignedTasks(reconcileParams);
    await new Promise((r) => setTimeout(r, 30));

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `[NativeDelivery:skip] ${ROLE}@${CHATROOM_ID} task ${TASK_ID} — task_state_active`
    );
  });

});
