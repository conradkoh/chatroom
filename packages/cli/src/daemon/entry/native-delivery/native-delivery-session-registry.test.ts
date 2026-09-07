import { Context, Runtime } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  getNativeDeliverySession,
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
  type NativeDeliverySessionRegistration,
} from './native-delivery-session-registry.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';

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
      taskSnapshotState: new MachineTaskSnapshotState(),
      agentOperationalReadModel: new AgentOperationalReadModel(),
      lifecycleOutbox: { enqueue: async () => undefined },
    };
    registerNativeDeliverySession(ctx);
    expect(getNativeDeliverySession()).toMatchObject(ctx);
    expect(getNativeDeliverySession()?.taskSnapshotState).toBe(ctx.taskSnapshotState);
    unregisterNativeDeliverySession();
    expect(getNativeDeliverySession()).toBeNull();
  });
});
