import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliverySkip,
  logNativeDeliveryTrigger,
} from './native-delivery-log.js';

describe('native-delivery-log', () => {
  afterEach(() => vi.restoreAllMocks());

  test('logNativeDeliveryTrigger identifies the event-driven source', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliveryTrigger('inbox-signal', 'builder', 'room_1', 'task_1');
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:trigger] source=inbox-signal builder@room_1 task task_1'
    );
  });

  test('logNativeDeliveryTrigger identifies periodic recovery', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logNativeDeliveryTrigger('periodic-reconcile', 'builder', 'room_1', 'task_1');
    expect(spy).toHaveBeenCalledWith(
      '[NativeDelivery:trigger] source=periodic-reconcile builder@room_1 task task_1'
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
