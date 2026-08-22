/** Phase E — daemon delivers pending tasks via operational SSOT after restart/start. */
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { handleTaskInboxUpdate } from './task-inbox-delivery.js';
import { unregisterNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import { RecoveryCooldown } from '../../entry/task-delivery/task-delivery-logic.js';
import {
  operationalRow,
  registerTestNativeDeliverySession,
} from '../agent-operational/test-support.js';

const runNativeInjectionEffect = vi.hoisted(() => vi.fn(() => Effect.void));
vi.mock('../../entry/native-delivery/native-task-injector.js', () => ({
  runNativeInjectionEffect,
}));

const CHATROOM_ID = 'phase-e-room';
const MACHINE_ID = 'phase-e-machine';

function slimPendingSnapshot() {
  return {
    taskId: 'phase-e-task' as never,
    chatroomId: CHATROOM_ID as never,
    status: 'pending' as const,
    assignedTo: 'builder',
    updatedAt: 1,
    createdAt: 1,
    agentConfig: {
      role: 'builder',
      machineId: MACHINE_ID,
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp',
    },
    participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
  };
}

function fullTaskFromSnapshot(row: ReturnType<typeof slimPendingSnapshot>) {
  return {
    ...row,
    taskContent: 'Phase E pending task',
    agentConfig: { ...row.agentConfig, model: 'composer-1' },
  };
}

function createAgentMgrMock(overrides: Record<string, unknown> = {}): never {
  return {
    getSlot: vi.fn().mockReturnValue({
      state: 'running',
      pid: 42,
      harnessSessionId: 'harness-1',
      nativeTurnPhase: 'idle',
    }),
    ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 42 }),
    clearStuckStoppingSlot: vi.fn().mockResolvedValue(false),
    setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    ...overrides,
  } as never;
}

function createSessionDeps(row: ReturnType<typeof slimPendingSnapshot>) {
  const full = fullTaskFromSnapshot(row);
  return {
    sessionId: 'session-phase-e',
    convexUrl: 'http://test',
    machineId: MACHINE_ID,
    logEvent: vi.fn(),
    backend: {
      mutation: vi.fn(),
      query: vi
        .fn()
        .mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
          'taskId' in args ? full : { tasks: [row] }
        ),
    },
  } as never;
}

describe('Phase E — pending task after agent restart', () => {
  afterEach(() => {
    unregisterNativeDeliverySession();
    vi.clearAllMocks();
  });

  test('delivers pending task when operational row is running without snapshot desiredState', async () => {
    const row = slimPendingSnapshot();
    const agentMgr = createAgentMgrMock();
    const sessionDeps = createSessionDeps(row);
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr,
      sessionDeps,
      machineId: MACHINE_ID,
      operationalRows: [operationalRow(CHATROOM_ID, 'builder', 'running')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      {
        runtime: Runtime.defaultRuntime as never,
        effectContext: Context.empty() as never,
        cooldown: new RecoveryCooldown(0),
        agentMgr,
        sessionDeps,
        machineId: MACHINE_ID,
      }
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalled());
    expect(row.agentConfig).not.toHaveProperty('desiredState');
  });

  test('wakes on stopped operational then delivers after transition to running without task signal', async () => {
    const row = slimPendingSnapshot();
    const ensureRunning = vi.fn().mockResolvedValue({ success: true, pid: 99_002 });
    const agentMgrStopped = createAgentMgrMock({
      getSlot: vi.fn().mockReturnValue(undefined),
      ensureRunning,
    });
    const sessionDeps = createSessionDeps(row);
    const deps = {
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      cooldown: new RecoveryCooldown(0),
      agentMgr: agentMgrStopped,
      sessionDeps,
      machineId: MACHINE_ID,
    };

    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: agentMgrStopped,
      sessionDeps,
      machineId: MACHINE_ID,
      operationalRows: [operationalRow(CHATROOM_ID, 'builder', 'stopped')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' },
      deps
    );
    await vi.waitFor(() => expect(ensureRunning).toHaveBeenCalledOnce());
    expect(runNativeInjectionEffect).not.toHaveBeenCalled();

    const agentMgrRunning = createAgentMgrMock();
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: agentMgrRunning,
      sessionDeps,
      machineId: MACHINE_ID,
      operationalRows: [operationalRow(CHATROOM_ID, 'builder', 'running')],
    });
    await handleTaskInboxUpdate(
      { signals: [], snapshots: [row as never], afterSignalKey: 'b', throughSignalKey: 'c' },
      { ...deps, agentMgr: agentMgrRunning }
    );
    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalled());
    expect(row.agentConfig).not.toHaveProperty('desiredState');
  });
});
