/**
 * Reproduces user-reported stuck pending after planner handoff.
 *
 * Observed daemon log pattern (user's full logs, 2026-07-13):
 *   role:planner status] idle
 *   [NativeDelivery:fallback] signal-presence planner@... task nh73a2nkkx65bg5z5dk403gm9s8afrz0 — reconcile
 *   (no agent_end, no inject — task stuck)
 *
 * Compare to working builder path in same logs:
 *   role:builder status] idle
 *   role:builder agent_end]
 *   [NativeDelivery:primary] turn idle builder@... — trying inject
 *
 * Root cause: OpenCode `session.status idle` logged without `session.idle`, so agent_end
 * never fired and nativeTurnPhase stayed turn_in_flight. Fixed in session-event-forwarder.ts.
 */

import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel.js';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { snapshotDocToSignal } from '@workspace/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-sync.js';
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  clearAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import { logNativeDeliveryFallback } from './native-delivery-log.js';
import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery-session-registry.js';
import {
  NativeTaskDeliveryCoordinator,
  notifyNativeTurnIdle,
} from './native-task-delivery-coordinator.js';
import { listTasksReadyForNudge, NudgeCooldown } from './task-monitor-logic.js';
import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';

const CHATROOM_ID = 'n57ctdnfvd0avh0ghx6p4szk8x8aa69a' as Id<'chatroom_rooms'>;
const TASK_ID = 'nh7dh7bj63fdns9zkyasjgnga58afx3s' as Id<'chatroom_tasks'>;
const MACHINE_ID = 'machine-planner-handoff-stuck';
const SESSION_ID = 'session-planner-handoff-stuck';
const SPAWNED_PID = 42_424;
const HARNESS_SESSION_ID = 'harness-planner-post-handoff';

function makePostHandoffPendingSnapshotDoc(
  overrides: Partial<Doc<'chatroom_machineAssignedTaskSnapshots'>> = {}
): Doc<'chatroom_machineAssignedTaskSnapshots'> {
  const now = 1_700_000_000_000;
  return {
    _id: 'snapshot_post_handoff' as Id<'chatroom_machineAssignedTaskSnapshots'>,
    _creationTime: now,
    machineId: MACHINE_ID,
    taskId: TASK_ID,
    chatroomId: CHATROOM_ID,
    role: 'planner',
    taskStatus: 'pending',
    taskAssignedTo: 'planner',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    agentHarness: 'cursor-sdk',
    workingDir: '/test/workspace',
    spawnedAgentPid: SPAWNED_PID,
    desiredState: 'running',
    configUpdatedAt: now,
    presenceUpdatedAt: now,
    presenceKey: 'presence-post-handoff',
    revisionKey: 'revision-post-handoff',
    signalUpdatedAt: now,
    lastSeenAction: NATIVE_WAITING_ACTION,
    lastSeenAt: now,
    lastStatus: 'agent.waiting',
    ...overrides,
  };
}

function makeTurnInFlightSlot() {
  return {
    state: 'running' as const,
    pid: SPAWNED_PID,
    harnessSessionId: HARNESS_SESSION_ID,
    nativeTurnPhase: 'turn_in_flight' as const,
  };
}

function makeIdleSlot() {
  return {
    state: 'running' as const,
    pid: SPAWNED_PID,
    harnessSessionId: HARNESS_SESSION_ID,
    nativeTurnPhase: 'idle' as const,
  };
}

function simulateSignalPresenceReconcile(params: {
  row: AssignedTaskSnapshotView;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  sessionDeps: Parameters<
    NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
  >[0]['sessionDeps'];
}): NativeTaskDeliveryCoordinator {
  const coordinator = new NativeTaskDeliveryCoordinator();
  logNativeDeliveryFallback(
    'signal-presence',
    params.row.agentConfig.role,
    params.row.chatroomId,
    params.row.taskId
  );
  coordinator.reconcileAssignedTasks({
    tasks: [params.row],
    runtime: Runtime.defaultRuntime as Parameters<
      NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
    >[0]['runtime'],
    effectContext: Context.empty() as Parameters<
      NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
    >[0]['effectContext'],
    agentMgr: params.agentMgr,
    sessionDeps: params.sessionDeps,
    machineId: MACHINE_ID,
  });
  return coordinator;
}

describe('native signal-presence stuck after planner handoff', () => {
  afterEach(() => {
    unregisterNativeDeliverySession();
    vi.restoreAllMocks();
  });

  test('reproduces user log: signal-presence reconcile while turn_in_flight does not inject', async () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);

    const signal = snapshotDocToSignal(makePostHandoffPendingSnapshotDoc());
    const row = snapshot.mergeSignal(signal);
    expect(row).toBeDefined();

    const presenceRow = snapshot.mergePresence({
      taskId: row!.taskId,
      chatroomId: row!.chatroomId,
      role: row!.agentConfig.role,
      lastSeenAt: row!.createdAt,
      lastSeenAction: NATIVE_WAITING_ACTION,
      presenceUpdatedAt: row!.createdAt,
      presenceKey: 'presence-post-handoff-2',
    });
    expect(presenceRow).toBeDefined();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue(makeTurnInFlightSlot()),
      resumeTurnForSlot,
      setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
    } as unknown as DaemonAgentProcessManagerServiceShape;

    simulateSignalPresenceReconcile({
      row: presenceRow!,
      agentMgr,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend: { mutation: vi.fn(), query: vi.fn() },
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[NativeDelivery:fallback] signal-presence planner@n57ctdnfvd0avh0ghx6p4szk8x8aa69a task nh7dh7bj63fdns9zkyasjgnga58afx3s — reconcile'
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[NativeDelivery:skip] planner@n57ctdnfvd0avh0ghx6p4szk8x8aa69a task nh7dh7bj63fdns9zkyasjgnga58afx3s — turn_not_idle'
      )
    );
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[NativeDelivery:inject]'));
  });

  test('reproduces stuck when notifyNativeTurnIdle already ran before pending task existed', async () => {
    unregisterNativeDeliverySession();
    clearAssignedTaskSnapshots();

    const backendQuery = vi.fn(async () => ({ tasks: [] }));
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);

    registerNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {
        getSlot: vi.fn().mockReturnValue(makeTurnInFlightSlot()),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
      } as never,
      sessionDeps: {
        sessionId: SESSION_ID,
        machineId: MACHINE_ID,
        convexUrl: 'http://test:3210',
        backend: { mutation: vi.fn(), query: backendQuery },
      },
      machineId: MACHINE_ID,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Store empty when turn went idle — primary path finds nothing (no HTTP hydrate).
    notifyNativeTurnIdle({ chatroomId: CHATROOM_ID, role: 'planner' });
    expect(backendQuery).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[NativeDelivery:skip] planner@n57ctdnfvd0avh0ghx6p4szk8x8aa69a — no pending tasks for role'
      )
    );
    resumeTurnForSlot.mockClear();

    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makePostHandoffPendingSnapshotDoc()));
    expect(row).toBeDefined();
    replaceAssignedTaskSnapshots([row!]);

    simulateSignalPresenceReconcile({
      row: row!,
      agentMgr: {
        getSlot: vi.fn().mockReturnValue(makeTurnInFlightSlot()),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as DaemonAgentProcessManagerServiceShape,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend: {
          mutation: vi.fn(),
          query: vi.fn(async () => ({ fullCliOutput: 'SHOULD NOT REACH' })),
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[NativeDelivery:skip] planner@n57ctdnfvd0avh0ghx6p4szk8x8aa69a')
    );

    clearAssignedTaskSnapshots();
    unregisterNativeDeliverySession();
    logSpy.mockRestore();
  });

  test('native nudge does not rescue within 15s when agent just went native:waiting', () => {
    const now = 1_700_000_000_000;
    const snapshot = createTaskMonitorSnapshot();
    const pendingRow = snapshot.mergeSignal(
      snapshotDocToSignal(makePostHandoffPendingSnapshotDoc())
    );
    expect(pendingRow).toBeDefined();

    const ready = listTasksReadyForNudge([pendingRow!], now + 5_000, new NudgeCooldown(0), () =>
      makeIdleSlot()
    );
    expect(ready).toHaveLength(0);
  });

  test('positive control: signal-presence reconcile injects when slot is idle after handoff', async () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(
      snapshotDocToSignal(
        makePostHandoffPendingSnapshotDoc({
          lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
          lastStatus: 'task.completed',
        })
      )
    );
    expect(row).toBeDefined();

    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    simulateSignalPresenceReconcile({
      row: row!,
      agentMgr: {
        getSlot: vi.fn().mockReturnValue(makeIdleSlot()),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as DaemonAgentProcessManagerServiceShape,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend: {
          mutation: vi.fn().mockResolvedValue(undefined),
          query: vi.fn(async (_fn, args) => {
            if (args && 'machineId' in args && !('chatroomId' in args)) {
              return { ...row, taskContent: '## Goal\nNew user message after handoff' };
            }
            if (args && 'chatroomId' in args) {
              return { fullCliOutput: 'POST HANDOFF DELIVERY' };
            }
            throw new Error(`Unexpected query: ${String(_fn)}`);
          }),
        },
      },
    });

    await vi.waitFor(() => {
      expect(resumeTurnForSlot).toHaveBeenCalled();
    });
  });
});
