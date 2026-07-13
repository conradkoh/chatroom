/**
 * G-criteria traceability — this file documents which automated tests cover refactor goals.
 * See docs/native-delivery-coordinator-refactor-plan.md § Full refactor acceptance criteria.
 */
import { describe, expect, test } from 'vitest';

import { logNativeDeliveryPrimary } from './native-delivery-log.js';
import { notifyNativeTurnIdle } from './native-task-delivery-coordinator.js';
import { shouldDeliverNativeTask } from './native-task-injector-logic.js';
import { isNativeSlotIdleForDelivery } from './native-turn-phase.js';
import { getRoleDeliveryState } from './role-delivery-state.js';

describe('native delivery refactor acceptance (G-criteria exports)', () => {
  test('G2/G5: shouldDeliverNativeTask and isNativeSlotIdleForDelivery are exported', () => {
    expect(typeof shouldDeliverNativeTask).toBe('function');
    expect(typeof isNativeSlotIdleForDelivery).toBe('function');
  });

  test('G3: notifyNativeTurnIdle is exported', () => {
    expect(typeof notifyNativeTurnIdle).toBe('function');
  });

  test('G4: getRoleDeliveryState is exported', () => {
    expect(typeof getRoleDeliveryState).toBe('function');
  });

  test('G3/G4: primary delivery log helper exists', () => {
    expect(typeof logNativeDeliveryPrimary).toBe('function');
  });
});
