import { describe, expect, test } from 'vitest';

import { NativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';
import { getRoleDeliveryState } from './role-delivery-state.js';

describe('NativeTaskDeliveryCoordinator', () => {
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
});
