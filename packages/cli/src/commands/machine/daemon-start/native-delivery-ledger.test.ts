import { describe, expect, test } from 'vitest';

import { NativeDeliveryLedger } from './native-delivery-ledger.js';

describe('NativeDeliveryLedger', () => {
  test('tracks deliveries per harness session', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
    ledger.markDelivered('task_a', 'sess_1');
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(true);
    ledger.clearDelivery('task_a', 'sess_1');
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
  });

  test('same task can deliver again after harness session changes', () => {
    const ledger = new NativeDeliveryLedger();
    ledger.markDelivered('task_a', 'sess_1');
    expect(ledger.isDelivered('task_a', 'sess_2')).toBe(false);
  });

  test('tryAcquire blocks duplicate concurrent delivery for same session', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(true);
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(false);
    ledger.markDelivered('task_a', 'sess_1');
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(false);
    ledger.clearDelivery('task_a', 'sess_1');
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(true);
  });

  test('clearSession drops entries for ended harness session', () => {
    const ledger = new NativeDeliveryLedger();
    ledger.markDelivered('task_a', 'sess_1');
    ledger.markDelivered('task_b', 'sess_2');
    ledger.clearSession('sess_1');
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
    expect(ledger.isDelivered('task_b', 'sess_2')).toBe(true);
  });

  test('tracks deliveries keyed by UUID provisional harness session id', () => {
    const ledger = new NativeDeliveryLedger();
    const provisionalId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(ledger.tryAcquire('task_a', provisionalId)).toBe(true);
    ledger.markDelivered('task_a', provisionalId);
    expect(ledger.isDelivered('task_a', provisionalId)).toBe(true);
    expect(
      ledger.isDelivered('task_a', 'different-uuid-00000000-0000-4000-8000-000000000001')
    ).toBe(false);
  });
});
