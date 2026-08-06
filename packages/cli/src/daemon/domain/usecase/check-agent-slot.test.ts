import { describe, expect, test } from 'vitest';

import {
  isSlotIdle,
  isSlotRunning,
  isSlotSpawning,
  isSlotStopping,
  isTurnPhaseIdle,
} from './check-agent-slot.js';

describe('check-agent-slot', () => {
  test('slot state predicates', () => {
    expect(isSlotIdle('idle')).toBe(true);
    expect(isSlotRunning('running')).toBe(true);
    expect(isSlotSpawning('spawning')).toBe(true);
    expect(isSlotStopping('stopping')).toBe(true);
    expect(isSlotIdle('running')).toBe(false);
  });

  test('isTurnPhaseIdle', () => {
    expect(isTurnPhaseIdle('idle')).toBe(true);
    expect(isTurnPhaseIdle('injecting')).toBe(false);
    expect(isTurnPhaseIdle('turn_in_flight')).toBe(false);
  });
});
