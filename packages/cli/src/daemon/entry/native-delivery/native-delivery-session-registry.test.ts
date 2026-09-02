import { Context, Runtime } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  getNativeDeliverySession,
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
  type NativeDeliverySessionRegistration,
} from './native-delivery-session-registry.js';

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
});
