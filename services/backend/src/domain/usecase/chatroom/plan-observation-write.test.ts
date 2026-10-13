import { describe, expect, it } from 'vitest';

import { planObservationWrite } from './plan-observation-write';
import { OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS } from '../../../../config/reliability';

const NOW = 1_000_000;

describe('planObservationWrite', () => {
  it('writes the first observation when no row exists', () => {
    expect(planObservationWrite(null, NOW, false)).toEqual({ lastObservedAt: NOW });
  });

  it('also sets lastRefreshedAt on the first observation when it is a refresh', () => {
    expect(planObservationWrite(null, NOW, true)).toEqual({
      lastObservedAt: NOW,
      lastRefreshedAt: NOW,
    });
  });

  it('skips a heartbeat inside the throttle window', () => {
    const existing = { lastObservedAt: NOW - (OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS - 1) };
    expect(planObservationWrite(existing, NOW, false)).toBeNull();
  });

  it('writes a heartbeat once the throttle window has passed', () => {
    const existing = { lastObservedAt: NOW - OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS };
    expect(planObservationWrite(existing, NOW, false)).toEqual({ lastObservedAt: NOW });
  });

  it('writes a refresh inside the throttle window, with lastRefreshedAt', () => {
    const existing = { lastObservedAt: NOW - 1 };
    expect(planObservationWrite(existing, NOW, true)).toEqual({
      lastObservedAt: NOW,
      lastRefreshedAt: NOW,
    });
  });

  it('writes a refresh past the throttle window, with lastRefreshedAt', () => {
    const existing = { lastObservedAt: NOW - OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS * 2 };
    expect(planObservationWrite(existing, NOW, true)).toEqual({
      lastObservedAt: NOW,
      lastRefreshedAt: NOW,
    });
  });
});
