import { describe, expect, test } from 'vitest';

import { NativeDeliveryLedger } from './native-delivery-ledger.js';

describe('NativeDeliveryLedger', () => {
  test('tracks deliveries per harness session', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(true);
    ledger.markDelivered('task_a', 'sess_1');
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(true);
    ledger.clearDelivery('task_a', 'sess_1');
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
  });

  test('same task can deliver again after harness session changes', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(true);
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

  test('attempt is keyed by task so session replacement cannot orphan it', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.tryAcquire('task_a', undefined)).toBe(true);
    // A duplicate reconcile while the cold start is in flight stays blocked,
    // even though no real session exists yet.
    expect(ledger.tryAcquire('task_a', undefined)).toBe(false);
    expect(ledger.tryAcquire('task_a', 'sess_real')).toBe(false);
    ledger.markDelivered('task_a', 'sess_real');
    expect(ledger.isDelivered('task_a', 'sess_real')).toBe(true);
    // The placeholder identity never becomes a delivered record.
    expect(ledger.tryAcquire('task_a', 'sess_real')).toBe(false);
  });

  test('clearSession drops completed records but never unlocks a running attempt', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.tryAcquire('task_a', undefined)).toBe(true);
    ledger.clearSession('sess_old');
    expect(ledger.isAttemptInFlight('task_a')).toBe(true);
    expect(ledger.tryAcquire('task_a', undefined)).toBe(false);
    ledger.releaseAttempt('task_a');
    expect(ledger.tryAcquire('task_a', undefined)).toBe(true);

    const completed = new NativeDeliveryLedger();
    expect(completed.tryAcquire('task_b', 'sess_1')).toBe(true);
    completed.markDelivered('task_b', 'sess_1');
    completed.clearSession('sess_1');
    expect(completed.isDelivered('task_b', 'sess_1')).toBe(false);
  });

  test('releaseAttempt unlocks without recording delivery', () => {
    const ledger = new NativeDeliveryLedger();
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(true);
    ledger.releaseAttempt('task_a');
    expect(ledger.isDelivered('task_a', 'sess_1')).toBe(false);
    expect(ledger.tryAcquire('task_a', 'sess_1')).toBe(true);
  });
});
