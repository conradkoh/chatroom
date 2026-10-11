import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createObservationTracker } from './observation-tier.js';
import type { WorkspaceSyncPolicy } from './workspace-sync-policy.js';

const POLICY: WorkspaceSyncPolicy['observation'] = {
  ttlMs: 60_000,
  graceMs: 15_000,
  initialSkewAllowanceMs: 60_000,
};
/** Age threshold below which a first-sight row counts as observed. */
const FIRST_SIGHT_THRESHOLD = POLICY.ttlMs + POLICY.initialSkewAllowanceMs;
/** Lifetime of one observation, measured from the moment it is recorded. */
const OBSERVATION_LIFETIME = POLICY.ttlMs + POLICY.graceMs;

/** Fake clock: the tracker must read time only through this function. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (value: number) => {
      t = value;
    },
  };
}

describe('createObservationTracker', () => {
  let clock: ReturnType<typeof fakeClock>;

  beforeEach(() => {
    clock = fakeClock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never reads Date.now()', () => {
    const spy = vi.spyOn(Date, 'now');
    const tracker = createObservationTracker(POLICY, clock.now);
    tracker.apply([{ workingDir: '/ws', lastObservedAt: clock.now() }]);
    tracker.tierOf('/ws');
    tracker.nextTransitionAt();
    expect(spy).not.toHaveBeenCalled();
  });

  describe('first sight', () => {
    it('is observed when the row is recent (a)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      tracker.apply([{ workingDir: '/ws', lastObservedAt: clock.now() - 1_000 }]);
      expect(tracker.tierOf('/ws')).toBe('observed');
    });

    it('is idle when the row is old, and when lastObservedAt is null (b)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      tracker.apply([
        { workingDir: '/old', lastObservedAt: clock.now() - FIRST_SIGHT_THRESHOLD },
        { workingDir: '/unknown', lastObservedAt: null },
      ]);
      expect(tracker.tierOf('/old')).toBe('idle');
      expect(tracker.tierOf('/unknown')).toBe('idle');
      expect(tracker.has('/old')).toBe(true);
    });

    it('uses only the row age, so a far-future timestamp is observed by the skew-free rule (e)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      tracker.apply([{ workingDir: '/future', lastObservedAt: clock.now() + 10 * 60_000 }]);
      // Age is negative, which is below the threshold, so the key counts as observed.
      expect(tracker.tierOf('/future')).toBe('observed');
    });

    it('treats the age threshold as exclusive (e)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      tracker.apply([
        { workingDir: '/just-inside', lastObservedAt: clock.now() - (FIRST_SIGHT_THRESHOLD - 1) },
        { workingDir: '/on-boundary', lastObservedAt: clock.now() - FIRST_SIGHT_THRESHOLD },
      ]);
      expect(tracker.tierOf('/just-inside')).toBe('observed');
      expect(tracker.tierOf('/on-boundary')).toBe('idle');
    });
  });

  describe('decay and re-observation', () => {
    it('decays to idle exactly at observedUntil (c)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);

      clock.set(start + OBSERVATION_LIFETIME - 1);
      expect(tracker.tierOf('/ws')).toBe('observed');

      clock.set(start + OBSERVATION_LIFETIME);
      expect(tracker.tierOf('/ws')).toBe('idle');
    });

    it('is observed again after a newer lastObservedAt arrives (d)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);

      clock.advance(OBSERVATION_LIFETIME + 1);
      expect(tracker.tierOf('/ws')).toBe('idle');

      const fresh = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: fresh }]);
      expect(tracker.tierOf('/ws')).toBe('observed');
    });

    it('does not revive a decayed key when the same or an older timestamp is re-sent', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);

      clock.advance(OBSERVATION_LIFETIME + 1);
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start - 5_000 }]);
      expect(tracker.tierOf('/ws')).toBe('idle');
    });

    it('treats a null lastObservedAt on a known key as no new information', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);
      clock.advance(1_000);
      const result = tracker.apply([{ workingDir: '/ws', lastObservedAt: null }]);
      expect(result.tierChanged).toEqual([]);
      expect(tracker.tierOf('/ws')).toBe('observed');
      clock.set(start + OBSERVATION_LIFETIME);
      expect(tracker.tierOf('/ws')).toBe('idle');
    });
  });

  describe('membership and tier changes', () => {
    it('reports added and removed keys (f)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const first = tracker.apply([
        { workingDir: '/a', lastObservedAt: clock.now() },
        { workingDir: '/b', lastObservedAt: clock.now() },
      ]);
      expect(first).toEqual({ added: ['/a', '/b'], removed: [], tierChanged: [] });

      const second = tracker.apply([
        { workingDir: '/b', lastObservedAt: clock.now() },
        { workingDir: '/c', lastObservedAt: clock.now() },
      ]);
      expect(second).toEqual({ added: ['/c'], removed: ['/a'], tierChanged: [] });
      expect(tracker.list()).toEqual(['/b', '/c']);
      expect(tracker.has('/a')).toBe(false);
    });

    it('reports the key whose observation decayed as tierChanged (g)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);

      clock.advance(OBSERVATION_LIFETIME);
      const result = tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);
      expect(result).toEqual({ added: [], removed: [], tierChanged: ['/ws'] });
      expect(tracker.tierOf('/ws')).toBe('idle');

      // Reporting is edge-triggered: a second apply with no change reports nothing.
      expect(tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]).tierChanged).toEqual([]);
    });

    it('reports idle to observed as tierChanged when a key is re-observed', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);
      clock.advance(OBSERVATION_LIFETIME);
      tracker.apply([{ workingDir: '/ws', lastObservedAt: start }]);

      const fresh = clock.now();
      const result = tracker.apply([{ workingDir: '/ws', lastObservedAt: fresh }]);
      expect(result.tierChanged).toEqual(['/ws']);
    });

    it('normalizes trailing separators so one workspace has one key', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      tracker.apply([
        { workingDir: '/ws/', lastObservedAt: clock.now() },
        { workingDir: '/ws', lastObservedAt: clock.now() },
      ]);
      expect(tracker.list()).toEqual(['/ws']);
      expect(tracker.tierOf('/ws/')).toBe('observed');
    });

    it('takes the maximum non-null lastObservedAt across duplicate rows', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([
        { workingDir: '/ws', lastObservedAt: start - FIRST_SIGHT_THRESHOLD },
        { workingDir: '/ws', lastObservedAt: start },
        { workingDir: '/ws', lastObservedAt: null },
      ]);
      expect(tracker.tierOf('/ws')).toBe('observed');
    });
  });

  describe('nextTransitionAt', () => {
    it('returns null when no key is observed (h)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      expect(tracker.nextTransitionAt()).toBeNull();

      tracker.apply([{ workingDir: '/old', lastObservedAt: clock.now() - FIRST_SIGHT_THRESHOLD }]);
      expect(tracker.nextTransitionAt()).toBeNull();
    });

    it('returns the earliest observedUntil and becomes null after everything decays (h)', () => {
      const tracker = createObservationTracker(POLICY, clock.now);
      const start = clock.now();
      tracker.apply([{ workingDir: '/early', lastObservedAt: start }]);
      clock.advance(5_000);
      tracker.apply([
        { workingDir: '/early', lastObservedAt: start },
        { workingDir: '/late', lastObservedAt: clock.now() },
      ]);

      expect(tracker.nextTransitionAt()).toBe(start + OBSERVATION_LIFETIME);

      clock.set(start + OBSERVATION_LIFETIME);
      expect(tracker.nextTransitionAt()).toBe(start + 5_000 + OBSERVATION_LIFETIME);

      clock.set(start + 5_000 + OBSERVATION_LIFETIME);
      expect(tracker.nextTransitionAt()).toBeNull();
    });
  });

  it('treats unknown keys as idle', () => {
    const tracker = createObservationTracker(POLICY, clock.now);
    expect(tracker.tierOf('/never-seen')).toBe('idle');
    expect(tracker.has('/never-seen')).toBe(false);
  });
});
