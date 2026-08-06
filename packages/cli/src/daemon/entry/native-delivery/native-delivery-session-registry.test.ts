import { Context, Runtime } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  getNativeDeliverySession,
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
  type NativeDeliverySessionContext,
} from './native-delivery-session-registry.js';

describe('native-delivery-session-registry', () => {
  test('returns null when not registered', () => {
    unregisterNativeDeliverySession();
    expect(getNativeDeliverySession()).toBeNull();
  });

  test('register and get round-trip', () => {
    const ctx: NativeDeliverySessionContext = {
      runtime: Runtime.defaultRuntime as NativeDeliverySessionContext['runtime'],
      effectContext: Context.empty() as NativeDeliverySessionContext['effectContext'],
      agentMgr: { getSlot: vi.fn() } as never,
      sessionDeps: {
        sessionId: 's',
        machineId: 'm',
        convexUrl: 'http://x',
        backend: { mutation: vi.fn(), query: vi.fn() },
      },
      machineId: 'm',
    };
    registerNativeDeliverySession(ctx);
    expect(getNativeDeliverySession()).toBe(ctx);
    unregisterNativeDeliverySession();
    expect(getNativeDeliverySession()).toBeNull();
  });
});
