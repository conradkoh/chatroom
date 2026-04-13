/**
 * CrashLoopTracker — Unit Tests
 *
 * Tests the sliding window restart detection with progressive backoff
 * used by the daemon to prevent crash loops from restarting agents indefinitely.
 */

import { describe, expect, test } from 'vitest';

import {
  CrashLoopTracker,
  CRASH_LOOP_MAX_RESTARTS,
  CRASH_LOOP_WINDOW_MS,
  BACKOFF_INTERVALS,
} from './crash-loop-tracker.js';

describe('CrashLoopTracker', () => {
  test('first restart is always allowed', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    const result = tracker.record('room-1', 'builder', now);
    expect(result.allowed).toBe(true);
    expect(result.restartCount).toBe(1);
    expect(result.nextAllowedAt).toBeUndefined();
    expect(result.waitMs).toBeUndefined();
  });

  test('allows immediate second restart when gap >= 30 seconds', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'builder', now);
    const result = tracker.record('room-1', 'builder', now + 30000);

    expect(result.allowed).toBe(true);
    expect(result.restartCount).toBe(2);
  });

  test('blocks second restart when gap < 30 seconds', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'builder', now);
    const result = tracker.record('room-1', 'builder', now + 10000);

    expect(result.allowed).toBe(false);
    expect(result.restartCount).toBe(2);
    expect(result.waitMs).toBe(20000); // 30s - 10s = 20s
    expect(result.nextAllowedAt).toBe(now + 30000);
  });

  test('returns allowed: false when exceeding CRASH_LOOP_MAX_RESTARTS', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // Allow first 10 restarts with proper backoff timing
    tracker.record('room-1', 'builder', now); // 1
    tracker.record('room-1', 'builder', now + 30000); // 2
    tracker.record('room-1', 'builder', now + 90000); // 3 (60s gap)
    tracker.record('room-1', 'builder', now + 150000); // 4 (60s gap)
    tracker.record('room-1', 'builder', now + 210000); // 5
    tracker.record('room-1', 'builder', now + 270000); // 6
    tracker.record('room-1', 'builder', now + 330000); // 7
    tracker.record('room-1', 'builder', now + 390000); // 8
    tracker.record('room-1', 'builder', now + 450000); // 9
    tracker.record('room-1', 'builder', now + 510000); // 10

    // This should be blocked (11th restart)
    const result = tracker.record('room-1', 'builder', now + 570000);
    expect(result.allowed).toBe(false);
    expect(result.restartCount).toBe(11);
  });

  test('sliding window: old timestamps outside the window are pruned', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // Record max restarts at the beginning
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

    // Record some restarts
    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 30000);

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
    // Second restart after 30s gap (allowed)
    tracker.record('room-1', 'builder', now + 30000);

    expect(tracker.getCount('room-1', 'builder', now + 60000)).toBe(2);

    // getCount should not change the count
    expect(tracker.getCount('room-1', 'builder', now + 60000)).toBe(2);
  });

  test('tracks independently per (chatroomId, role) key', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'builder', now);
    // Second restart after 30s gap (allowed)
    tracker.record('room-1', 'builder', now + 30000);
    tracker.record('room-2', 'builder', now);

    expect(tracker.getCount('room-1', 'builder', now + 60000)).toBe(2);
    expect(tracker.getCount('room-2', 'builder', now + 60000)).toBe(1);
    expect(tracker.getCount('room-1', 'planner', now + 60000)).toBe(0);
  });

  test('role is case-insensitive', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'Builder', now);
    tracker.record('room-1', 'BUILDER', now + 30000);
    tracker.record('room-1', 'builder', now + 90000);

    expect(tracker.getCount('room-1', 'builder', now + 120000)).toBe(3);
    expect(tracker.getCount('room-1', 'BUILDER', now + 120000)).toBe(3);
  });

  test('windowMs is always returned in the result', () => {
    const tracker = new CrashLoopTracker();
    const result = tracker.record('room-1', 'builder');
    expect(result.windowMs).toBe(CRASH_LOOP_WINDOW_MS);
  });
});

describe('Progressive Backoff', () => {
  test('BACKOFF_INTERVALS are defined correctly', () => {
    expect(BACKOFF_INTERVALS[0]).toBe(0); // Immediate
    expect(BACKOFF_INTERVALS[1]).toBe(30000); // 30 seconds
    expect(BACKOFF_INTERVALS[2]).toBe(60000); // 60 seconds
  });

  test('third restart requires 60 second gap', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // First two restarts with proper gaps
    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 30000);

    // Third restart too soon (< 60s) - should be blocked
    const tooSoon = tracker.record('room-1', 'builder', now + 60000);
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.restartCount).toBe(3);
    expect(tooSoon.waitMs).toBe(30000); // 60s - 30s = 30s
    expect(tooSoon.nextAllowedAt).toBe(now + 90000);

    // After 60s gap from second restart - should be allowed
    const after60s = tracker.record('room-1', 'builder', now + 90000);
    expect(after60s.allowed).toBe(true);
    expect(after60s.restartCount).toBe(3);
  });

  test('subsequent restarts also require 60 second gap', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // First two restarts
    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 30000);

    // Third restart
    tracker.record('room-1', 'builder', now + 90000);

    // Fourth restart too soon (< 60s from third) - should be blocked
    const fourthTooSoon = tracker.record('room-1', 'builder', now + 120000);
    expect(fourthTooSoon.allowed).toBe(false);
    expect(fourthTooSoon.waitMs).toBe(30000); // 60s - 30s = 30s

    // After 60s gap - should be allowed
    const fourthAllowed = tracker.record('room-1', 'builder', now + 150000);
    expect(fourthAllowed.allowed).toBe(true);
    expect(fourthAllowed.restartCount).toBe(4);
  });

  test('rapid restarts accumulate in history and affect next backoff calculation', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // First restart
    tracker.record('room-1', 'builder', now);

    // Multiple rapid restart attempts (each blocked)
    for (let i = 0; i < 5; i++) {
      tracker.record('room-1', 'builder', now + 5000);
    }

    // After 30s from first restart, second should be allowed
    const second = tracker.record('room-1', 'builder', now + 30000);
    expect(second.allowed).toBe(true);
    expect(second.restartCount).toBe(2); // First + second
  });

  test('restart attempts beyond BACKOFF_INTERVALS length use last interval', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // First two restarts with proper gaps
    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 30000);

    // Multiple third restart attempts (all use 60s backoff)
    for (let i = 0; i < 3; i++) {
      const attempt = tracker.record('room-1', 'builder', now + 60000 + i * 10000);
      expect(attempt.waitMs).toBe(60000 - 30000 - i * 10000);
    }
  });

  test('handles clock drift gracefully (now < lastRestart)', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    tracker.record('room-1', 'builder', now);
    // Clock moved back - still within window
    const result = tracker.record('room-1', 'builder', now - 1000);

    // Should block because gap appears < 0 (treated as very recent)
    expect(result.allowed).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  test('allows restart after window expires and resets backoff', () => {
    const tracker = new CrashLoopTracker();
    const now = 1000000;

    // Fill up some restarts
    tracker.record('room-1', 'builder', now);
    tracker.record('room-1', 'builder', now + 30000);

    // Jump past window - old restarts are pruned (windowStart = now - windowMs)
    // So if now = 1000000 and windowMs = 600000, old entries < 400000 are pruned
    // But our entries are at 1000000 and 1030000, so they're kept
    // We need to jump way past the window
    const afterWindow = tracker.record('room-1', 'builder', now + CRASH_LOOP_WINDOW_MS * 2);

    // Should be allowed (fresh start)
    expect(afterWindow.allowed).toBe(true);
    // Count = 1 because only the new restart is recorded (old ones pruned)
    expect(afterWindow.restartCount).toBe(1);
  });
});
