import { Context, Runtime } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery-session-registry.js';
import {
  NativeTaskDeliveryCoordinator,
  notifyNativeTurnIdle,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import {
  clearAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';

function makeRow() {
  return {
    taskId: 'task_1' as never,
    chatroomId: 'room_1' as never,
    status: 'pending' as const,
    assignedTo: 'builder',
    updatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    agentConfig: {
      role: 'builder',
      machineId: 'm',
      agentHarness: 'cursor-sdk',
      workingDir: '/test',
      spawnedAgentPid: 42_424,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'native:waiting',
      lastSeenAt: 1_700_000_000_000,
      lastStatus: 'agent.waiting',
    },
  };
}

describe('NativeTaskDeliveryCoordinator', () => {
  beforeEach(() => {
    clearAssignedTaskSnapshots();
  });

  afterEach(() => {
    clearAssignedTaskSnapshots();
    unregisterNativeDeliverySession();
  });

  test('onSessionLost resets role delivery generation', () => {
    const coordinator = new NativeTaskDeliveryCoordinator();
    const state = getRoleDeliveryState();
    const before = state.getGeneration('room_1', 'builder');
    coordinator.onSessionLost({
      chatroomId: 'room_1',
      role: 'builder',
      harnessSessionId: 'sess_1',
    });
    expect(state.getGeneration('room_1', 'builder')).toBe(before + 1);
  });

  test('tryInjectNextForRole no-ops when session not registered', () => {
    unregisterNativeDeliverySession();
    const coordinator = new NativeTaskDeliveryCoordinator();
    const spy = vi.spyOn(coordinator, 'reconcileAssignedTasks');

    coordinator.tryInjectNextForRole('room_1', 'builder');

    expect(spy).not.toHaveBeenCalled();
  });

  test('tryInjectNextForRole calls reconcile when session registered and store has matching tasks', () => {
    unregisterNativeDeliverySession();

    const row = makeRow();
    replaceAssignedTaskSnapshots([row as never]);

    const backendQuery = vi.fn(async (_fn: unknown, args: unknown) => {
      if (args && typeof args === 'object' && 'chatroomId' in args) {
        return { fullCliOutput: 'DELIVERY OUTPUT' };
      }
      if (args && typeof args === 'object' && 'taskId' in args) {
        return { ...row, taskContent: '' };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    });

    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);

    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: 's',
      machineId: 'm',
      convexUrl: 'http://x',
      backend: { mutation: backendMutation, query: backendQuery },
    };

    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: 42_424,
        harnessSessionId: 'sess_1',
        nativeTurnPhase: 'idle' as const,
      }),
      resumeTurnForSlot,
      setLastInFlightTask: vi.fn().mockReturnValue(Runtime.defaultRuntime),
    };

    registerNativeDeliverySession({
      runtime: Runtime.defaultRuntime as Parameters<
        NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
      >[0]['runtime'],
      effectContext: Context.empty() as Parameters<
        NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
      >[0]['effectContext'],
      agentMgr: agentMgr as never,
      sessionDeps,
      machineId: 'm',
    });

    const coordinator = new NativeTaskDeliveryCoordinator();
    const spy = vi.spyOn(coordinator, 'reconcileAssignedTasks');

    coordinator.tryInjectNextForRole('room_1', 'builder');

    expect(spy).toHaveBeenCalled();
  });

  test('notifyNativeTurnIdle does not throw', () => {
    unregisterNativeDeliverySession();
    expect(() => notifyNativeTurnIdle({ chatroomId: 'room_1', role: 'builder' })).not.toThrow();
  });

  test('G10: tryInjectNextForRole does not inject when store has no matching tasks', () => {
    unregisterNativeDeliverySession();
    clearAssignedTaskSnapshots();

    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);

    registerNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {
        getSlot: vi.fn(),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(),
      } as never,
      sessionDeps: {
        sessionId: 's',
        machineId: 'm',
        convexUrl: 'http://x',
        backend: { mutation: vi.fn(), query: vi.fn() },
      },
      machineId: 'm',
    });

    const coordinator = new NativeTaskDeliveryCoordinator();
    const spy = vi.spyOn(coordinator, 'reconcileAssignedTasks');

    coordinator.tryInjectNextForRole('room_1', 'builder');

    expect(spy).not.toHaveBeenCalled();
  });
});
