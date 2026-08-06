import { describe, expect, test } from 'vitest';

import {
  defaultNativeTurnPhase,
  isNativeSlotIdleForDelivery,
  setNativeTurnPhase,
} from './native-turn-phase.js';
import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

describe('native-turn-phase', () => {
  test('defaultNativeTurnPhase is idle', () => {
    expect(defaultNativeTurnPhase()).toBe('idle');
  });

  test('isNativeSlotIdleForDelivery true when running and phase idle', () => {
    const slot: AgentSlot = { state: 'running', nativeTurnPhase: 'idle' };
    expect(isNativeSlotIdleForDelivery(slot)).toBe(true);
  });

  test('isNativeSlotIdleForDelivery true when running and phase undefined', () => {
    const slot: AgentSlot = { state: 'running' };
    expect(isNativeSlotIdleForDelivery(slot)).toBe(true);
  });

  test('isNativeSlotIdleForDelivery false when turn_in_flight', () => {
    const slot: AgentSlot = { state: 'running', nativeTurnPhase: 'turn_in_flight' };
    expect(isNativeSlotIdleForDelivery(slot)).toBe(false);
  });

  test('isNativeSlotIdleForDelivery false when injecting', () => {
    const slot: AgentSlot = { state: 'running', nativeTurnPhase: 'injecting' };
    expect(isNativeSlotIdleForDelivery(slot)).toBe(false);
  });

  test('isNativeSlotIdleForDelivery false when not running', () => {
    const slot: AgentSlot = { state: 'spawning', nativeTurnPhase: 'idle' };
    expect(isNativeSlotIdleForDelivery(slot)).toBe(false);
  });

  test('setNativeTurnPhase mutates slot', () => {
    const slot: AgentSlot = { state: 'running' };
    setNativeTurnPhase(slot, 'turn_in_flight');
    expect(slot.nativeTurnPhase).toBe('turn_in_flight');
  });
});
