import { describe, expect, test } from 'vitest';

import { RapidResumeTracker } from './rapid-resume-tracker.js';

describe('RapidResumeTracker', () => {
  test('does not flag storm below threshold', () => {
    const tracker = new RapidResumeTracker();
    const t0 = 1_000_000;
    const { threshold } = tracker.record('room', 'builder', t0);
    for (let i = 1; i < threshold; i++) {
      const result = tracker.record('room', 'builder', t0 + i * 100);
      expect(result.isStorm).toBe(false);
    }
  });

  test('flags storm at threshold within window', () => {
    const tracker = new RapidResumeTracker();
    const t0 = 2_000_000;
    let last = tracker.record('room', 'builder', t0);
    for (let i = 1; i < last.threshold; i++) {
      last = tracker.record('room', 'builder', t0 + i * 200);
    }
    expect(last.isStorm).toBe(true);
    expect(last.endCount).toBe(last.threshold);
    expect(last.windowMs).toBe(30_000);
  });

  test('prunes ends outside the sliding window', () => {
    const tracker = new RapidResumeTracker();
    const t0 = 3_000_000;
    const first = tracker.record('room', 'builder', t0);
    const result = tracker.record('room', 'builder', t0 + first.windowMs + 1);
    expect(result.endCount).toBe(1);
    expect(result.isStorm).toBe(false);
  });

  test('reset clears history for role', () => {
    const tracker = new RapidResumeTracker();
    const t0 = 4_000_000;
    const { threshold } = tracker.record('room', 'builder', t0);
    for (let i = 1; i < threshold; i++) {
      tracker.record('room', 'builder', t0 + i);
    }
    tracker.reset('room', 'builder');
    const result = tracker.record('room', 'builder', t0 + 10);
    expect(result.endCount).toBe(1);
    expect(result.isStorm).toBe(false);
  });
});
