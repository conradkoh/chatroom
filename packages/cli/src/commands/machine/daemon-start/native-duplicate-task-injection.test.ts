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

import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import {
  getNativeDeliveryLedger,
  resetNativeDeliveryLedgerForTests,
} from './native-delivery-ledger.js';
import { NativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';
import { explainLedgerDeliveryBlock } from './native-task-injector-logic.js';

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
    setLastInFlightTask: vi.fn().mockImplementation(() => Effect.void),
  } as unknown as DaemonAgentProcessManagerServiceShape;
}

describe('native duplicate task injection', () => {
  afterEach(() => {
    resetNativeDeliveryLedgerForTests();
    vi.restoreAllMocks();
  });

  test('explainLedgerDeliveryBlock blocks after markDelivered', () => {
    const ledger = getNativeDeliveryLedger();
    expect(explainLedgerDeliveryBlock(TASK_ID, HARNESS_SESSION_ID, ledger)).toBeNull();
    ledger.markDelivered(TASK_ID, HARNESS_SESSION_ID);
    expect(explainLedgerDeliveryBlock(TASK_ID, HARNESS_SESSION_ID, ledger)).toBe(
      'already_delivered_this_session'
    );
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

    const reconcileParams = {
      tasks: [row],
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps: {
        sessionId: 'session_dup',
        machineId: 'machine_dup',
        convexUrl: 'http://test:3210',
        backend: { mutation: backendMutation, query: backendQuery },
      },
      machineId: 'machine_dup',
    };

    coordinator.reconcileAssignedTasks(reconcileParams);
    await vi.waitFor(() => {
      expect(getNativeDeliveryLedger().isDelivered(TASK_ID, HARNESS_SESSION_ID)).toBe(true);
    });

    resumeTurnForSlot.mockClear();
    logSpy.mockClear();

    coordinator.reconcileAssignedTasks(reconcileParams);
    await new Promise((r) => setTimeout(r, 30));

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `[NativeDelivery:skip] ${ROLE}@${CHATROOM_ID} task ${TASK_ID} — already_delivered_this_session`
    );
  });
});
