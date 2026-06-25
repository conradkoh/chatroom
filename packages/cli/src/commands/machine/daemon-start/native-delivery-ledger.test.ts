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
});
