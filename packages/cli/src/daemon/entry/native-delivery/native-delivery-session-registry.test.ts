import { Context, Runtime } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  getNativeDeliverySession,
  registerNativeDeliverySession,
  recordNativeTaskDelivered,
  recordNativeTaskHandedOff,
  unregisterNativeDeliverySession,
  type NativeDeliverySessionRegistration,
} from './native-delivery-session-registry.js';
import { createAgentTaskStateService } from '../../infrastructure/agent-process-manager/components/agent-task-state/index.js';

describe('native-delivery-session-registry', () => {
  test('returns null when not registered', () => {
    unregisterNativeDeliverySession();
    expect(getNativeDeliverySession()).toBeNull();
  });

  test('register and get round-trip', () => {
    const ctx: NativeDeliverySessionRegistration = {
      runtime: Runtime.defaultRuntime as NativeDeliverySessionRegistration['runtime'],
      effectContext: Context.empty() as NativeDeliverySessionRegistration['effectContext'],
      agentMgr: { getSlot: vi.fn() } as never,
      runSerializedForAgent: vi.fn(),
      sessionDeps: {
        sessionId: 's',
        machineId: 'm',
        logEvent: async () => undefined,
        convexUrl: 'http://x',
        backend: { mutation: vi.fn(), query: vi.fn() },
      },
      machineId: 'm',
    };
    registerNativeDeliverySession(ctx);
    expect(getNativeDeliverySession()).toMatchObject(ctx);
    expect(getNativeDeliverySession()?.taskSnapshotState).toBeDefined();
    unregisterNativeDeliverySession();
    expect(getNativeDeliverySession()).toBeNull();
  });

  test('tracks delivery and explicit handoff through the shared task state', () => {
    const agentTaskState = createAgentTaskStateService({
      reminder: { remind: async () => undefined },
    });
    const ctx: NativeDeliverySessionRegistration = {
      runtime: Runtime.defaultRuntime as NativeDeliverySessionRegistration['runtime'],
      effectContext: Context.empty() as NativeDeliverySessionRegistration['effectContext'],
      agentMgr: { getSlot: vi.fn() } as never,
      runSerializedForAgent: vi.fn(),
      sessionDeps: {
        sessionId: 's',
        machineId: 'm',
        logEvent: async () => undefined,
        convexUrl: 'http://x',
        backend: { mutation: vi.fn(), query: vi.fn() },
      },
      machineId: 'm',
      agentTaskState,
    };

    registerNativeDeliverySession(ctx);
    recordNativeTaskDelivered({ chatroomId: 'room', role: 'builder', taskId: 'task_1' });
    expect(agentTaskState.get({ chatroomId: 'room', role: 'builder' })).toMatchObject({
      taskId: 'task_1',
      generation: 1,
      handedOff: false,
    });

    recordNativeTaskHandedOff({ chatroomId: 'room', role: 'builder', taskId: 'task_1' });
    expect(agentTaskState.get({ chatroomId: 'room', role: 'builder' })).toMatchObject({
      taskId: 'task_1',
      handedOff: true,
    });

    unregisterNativeDeliverySession();
  });
});
