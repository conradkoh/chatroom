/**
 * CrashLoopTracker — Unit Tests
 *
 * Tests the sliding window restart detection used by the daemon to prevent
 * crash loops from restarting agents indefinitely.
 */

import { describe, expect, test } from 'vitest';

import {
  CrashLoopTracker,
  CRASH_LOOP_MAX_RESTARTS,
  CRASH_LOOP_WINDOW_MS,
} from './crash-loop-tracker.js';

describe('CrashLoopTracker', () => {
  test('allows restarts up to CRASH_LOOP_MAX_RESTARTS within the window', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    for (let i = 1; i <= CRASH_LOOP_MAX_RESTARTS; i++) {
      const result = tracker.record('room-1', 'builder', now + i * 1000);
      expect(result.allowed).toBe(true);
      expect(result.restartCount).toBe(i);
    }
  });

  test('returns allowed: false when exceeding CRASH_LOOP_MAX_RESTARTS', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // Fill up to max
    for (let i = 1; i <= CRASH_LOOP_MAX_RESTARTS; i++) {
      tracker.record('room-1', 'builder', now + i * 1000);
    }

    // This should be blocked (4th restart)
    const result = tracker.record('room-1', 'builder', now + (CRASH_LOOP_MAX_RESTARTS + 1) * 1000);
    expect(result.allowed).toBe(false);
    expect(result.restartCount).toBe(CRASH_LOOP_MAX_RESTARTS + 1);
  });

  test('sliding window: old timestamps outside the window are pruned', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // Record 3 restarts at the beginning
    for (let i = 0; i < CRASH_LOOP_MAX_RESTARTS; i++) {
      tracker.record('room-1', 'builder', now);
    }

    // After the window expires completely, all old restarts should be pruned
    const afterWindow = now + CRASH_LOOP_WINDOW_MS + 1000;
    const result = tracker.record('room-1', 'builder', afterWindow);
    expect(result.allowed).toBe(true);
    expect(result.restartCount).toBe(1); // Only the new restart
  });

  test('clear() resets the history — next record() starts fresh', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // Fill up to max
    for (let i = 0; i < CRASH_LOOP_MAX_RESTARTS; i++) {
      tracker.record('room-1', 'builder', now + i);
    }

    // Clear and verify fresh start
    tracker.clear('room-1', 'builder');
    const result = tracker.record('room-1', 'builder', now + 10000);
    expect(result.allowed).toBe(true);
    expect(result.restartCount).toBe(1);
  });

  test('getCount() returns correct count without recording a new restart', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 1000);

    expect(tracker.getCount('room-1', 'builder', now + 2000)).toBe(2);

    // getCount should not change the count
    expect(tracker.getCount('room-1', 'builder', now + 2000)).toBe(2);
  });

  test('tracks independently per (chatroomId, role) key', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 1000);
    tracker.record('room-2', 'builder', now);

    expect(tracker.getCount('room-1', 'builder', now + 2000)).toBe(2);
    expect(tracker.getCount('room-2', 'builder', now + 2000)).toBe(1);
    expect(tracker.getCount('room-1', 'planner', now + 2000)).toBe(0);
  });

  test('role is case-insensitive', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'Builder', now);
    tracker.record('room-1', 'BUILDER', now + 1000);
    tracker.record('room-1', 'builder', now + 2000);

    expect(tracker.getCount('room-1', 'builder', now + 3000)).toBe(3);
    expect(tracker.getCount('room-1', 'BUILDER', now + 3000)).toBe(3);
  });

  test('windowMs is always returned in the result', () => {
    const tracker = new CrashLoopTracker();
    const result = tracker.record('room-1', 'builder');
    expect(result.windowMs).toBe(CRASH_LOOP_WINDOW_MS);
  });
});
