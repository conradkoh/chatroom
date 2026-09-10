import { describe, expect, test, beforeEach } from 'vitest';

import { getRoleDeliveryState } from './role-delivery-state.js';

describe('role-delivery-state (G4: per-role delivery mutex)', () => {
  beforeEach(() => {
    const state = getRoleDeliveryState();
    state.releaseDelivery('room_g4', 'builder');
    state.releaseDelivery('room_g4', 'planner');
  });

  test('tryAcquireDelivery allows first acquire, blocks second', () => {
    const state = getRoleDeliveryState();
    expect(state.tryAcquireDelivery('room_g4', 'builder')).toBe(true);
    expect(state.tryAcquireDelivery('room_g4', 'builder')).toBe(false);
  });

  test('releaseDelivery allows re-acquire', () => {
    const state = getRoleDeliveryState();
    expect(state.tryAcquireDelivery('room_g4', 'builder')).toBe(true);
    state.releaseDelivery('room_g4', 'builder');
    expect(state.tryAcquireDelivery('room_g4', 'builder')).toBe(true);
  });

  test('resetDeliveryState bumps generation and clears in-flight', () => {
    const state = getRoleDeliveryState();
    const before = state.getGeneration('room_g4', 'builder');
    state.tryAcquireDelivery('room_g4', 'builder');
    const next = state.resetDeliveryState('room_g4', 'builder');
    expect(next).toBe(before + 1);
    expect(state.tryAcquireDelivery('room_g4', 'builder')).toBe(true);
  });

  test('different roles do not block each other', () => {
    const state = getRoleDeliveryState();
    expect(state.tryAcquireDelivery('room_g4', 'builder')).toBe(true);
    expect(state.tryAcquireDelivery('room_g4', 'planner')).toBe(true);
  });
});
