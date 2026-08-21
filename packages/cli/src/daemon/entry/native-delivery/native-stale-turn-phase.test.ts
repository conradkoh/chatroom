import { describe, expect, it } from 'vitest';

import { isStaleTurnInFlightWhileWaiting } from './native-stale-turn-phase.js';

const task = (status: 'pending' | 'acknowledged', lastSeenAction: string | null) =>
  ({ status, participant: { lastSeenAction } }) as never;

describe('isStaleTurnInFlightWhileWaiting', () => {
  it('recognizes pending native waiting with an in-flight slot', () => {
    expect(
      isStaleTurnInFlightWhileWaiting(task('pending', 'native:waiting'), {
        nativeTurnPhase: 'turn_in_flight',
      } as never)
    ).toBe(true);
  });
  it('does not recover acknowledged or idle tasks', () => {
    expect(
      isStaleTurnInFlightWhileWaiting(task('acknowledged', 'native:waiting'), {
        nativeTurnPhase: 'turn_in_flight',
      } as never)
    ).toBe(false);
    expect(
      isStaleTurnInFlightWhileWaiting(task('pending', 'native:waiting'), {
        nativeTurnPhase: 'idle',
      } as never)
    ).toBe(false);
  });
});
