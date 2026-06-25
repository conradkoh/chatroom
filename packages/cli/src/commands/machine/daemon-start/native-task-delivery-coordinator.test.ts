import { describe, expect, test } from 'vitest';

import { NativeDeliveryLedger } from './native-delivery-ledger.js';
import { NativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';

describe('NativeTaskDeliveryCoordinator', () => {
  test('onSessionLost clears ledger entries for ended harness session', () => {
    const ledger = new NativeDeliveryLedger();
    const coordinator = new NativeTaskDeliveryCoordinator(ledger);

    ledger.markDelivered('task_a', 'sess_1');
    ledger.markDelivered('task_b', 'sess_2');

    coordinator.onSessionLost({
      chatroomId: 'room_1',
      role: 'planner',
      harnessSessionId: 'sess_1',
    });

    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
    expect(ledger.isDelivered('task_b', 'sess_2')).toBe(true);
  });
});
