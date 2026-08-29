import { describe, expect, it } from 'vitest';

import { isStaleTurnInFlightWhileWaiting } from './native-stale-turn-phase.js';

const task = (status: 'pending' | 'acknowledged') => ({ status }) as never;

describe('isStaleTurnInFlightWhileWaiting', () => {
  it('recognizes pending task with stale in-flight slot', () => {
    expect(
      isStaleTurnInFlightWhileWaiting(task('pending'), {
        nativeTurnPhase: 'turn_in_flight',
      } as never)
    ).toBe(true);
  });
  it('does not recover acknowledged tasks or idle slots', () => {
    expect(
      isStaleTurnInFlightWhileWaiting(task('acknowledged'), {
        nativeTurnPhase: 'turn_in_flight',
      } as never)
    ).toBe(false);
    expect(
      isStaleTurnInFlightWhileWaiting(task('pending'), {
        nativeTurnPhase: 'idle',
      } as never)
    ).toBe(false);
  });

  it('does not reconcile without a slot', () => {
    expect(isStaleTurnInFlightWhileWaiting(task('pending'), undefined)).toBe(false);
  });
});
