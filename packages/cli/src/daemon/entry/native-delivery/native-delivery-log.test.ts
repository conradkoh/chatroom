import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  logNativeDeliveryFallback,
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliveryPrimary,
  logNativeDeliverySkip,
} from './native-delivery-log.js';

describe('native-delivery-log', () => {
  afterEach(() => vi.restoreAllMocks());

  test('logNativeDeliveryPrimary uses primary prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliveryPrimary('builder', 'room_1');
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:primary] turn idle builder@room_1 — trying inject'
    );
  });

  test('logNativeDeliveryFallback uses fallback prefix with reason', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliveryFallback('native-light-nudge', 'builder', 'room_1', 'task_1');
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:fallback] native-light-nudge builder@room_1 task task_1 — reconcile'
    );
  });

  test('logNativeDeliverySkip includes block reason', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliverySkip(
      'builder',
      'room_1',
      'task_1',
      'turn_not_idle (nativeTurnPhase=turn_in_flight)'
    );
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:skip] builder@room_1 task task_1 — turn_not_idle (nativeTurnPhase=turn_in_flight)'
    );
  });

  test('logNativeDeliveryInjecting uses inject prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliveryInjecting('builder', 'room_1', 'task_1');
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:inject] builder@room_1 task task_1 — starting injection'
    );
  });

  test('logNativeDeliveryMutexSkip explains mutex contention', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliveryMutexSkip('builder', 'room_1', 'task_1');
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:skip] builder@room_1 task task_1 — delivery_mutex_busy (another inject in flight)'
    );
  });
});
