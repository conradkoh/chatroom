/**
 * Frécency Scoring Engine — Tests
 */

import { describe, expect, test } from 'vitest';
import {
  computeFrecencyScore,
  computeAllFrecencyScores,
  getMaxFrecencyScore,
  createRankedFilter,
} from './frecencyScoring';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('computeFrecencyScore', () => {
  const now = 1700000000000; // Fixed reference time

  test('returns 0 for empty timestamps', () => {
    expect(computeFrecencyScore([], now)).toBe(0);
  });

  test('scores highest for very recent usage (< 4 hours)', () => {
    const timestamps = [now - 1 * HOUR];
    expect(computeFrecencyScore(timestamps, now)).toBe(100);
  });

  test('scores for usage within 24 hours', () => {
    const timestamps = [now - 12 * HOUR];
    expect(computeFrecencyScore(timestamps, now)).toBe(80);
  });

  test('scores for usage within 3 days', () => {
    const timestamps = [now - 2 * DAY];
    expect(computeFrecencyScore(timestamps, now)).toBe(60);
  });

  test('scores for usage within 7 days', () => {
    const timestamps = [now - 5 * DAY];
    expect(computeFrecencyScore(timestamps, now)).toBe(40);
  });

  test('scores for usage within 14 days', () => {
    const timestamps = [now - 10 * DAY];
    expect(computeFrecencyScore(timestamps, now)).toBe(20);
  });

  test('scores for usage within 30 days', () => {
    const timestamps = [now - 20 * DAY];
    expect(computeFrecencyScore(timestamps, now)).toBe(10);
  });

  test('drops timestamps older than 30 days', () => {
    const timestamps = [now - 31 * DAY];
    expect(computeFrecencyScore(timestamps, now)).toBe(0);
  });

  test('sums scores for multiple usages', () => {
    const timestamps = [
      now - 1 * HOUR,   // weight: 100
      now - 12 * HOUR,  // weight: 80
      now - 5 * DAY,    // weight: 40
    ];
    expect(computeFrecencyScore(timestamps, now)).toBe(220);
  });

  test('frequent recent usage scores highest', () => {
    const frequentRecent = [
      now - 1 * HOUR,
      now - 2 * HOUR,
      now - 3 * HOUR,
    ]; // 3 × 100 = 300

    const frequentOld = [
      now - 20 * DAY,
      now - 21 * DAY,
      now - 22 * DAY,
      now - 23 * DAY,
      now - 24 * DAY,
    ]; // 5 × 10 = 50

    expect(computeFrecencyScore(frequentRecent, now)).toBeGreaterThan(
      computeFrecencyScore(frequentOld, now)
    );
  });

  test('ignores future timestamps', () => {
    const timestamps = [now + 1000]; // Future
    expect(computeFrecencyScore(timestamps, now)).toBe(0);
  });
});

describe('computeAllFrecencyScores', () => {
  const now = 1700000000000;

  test('computes scores for all commands', () => {
    const usage = new Map<string, number[]>();
    usage.set('cmd-a', [now - 1 * HOUR]);
    usage.set('cmd-b', [now - 5 * DAY]);

    const scores = computeAllFrecencyScores(usage, now);
    expect(scores.get('cmd-a')).toBe(100);
    expect(scores.get('cmd-b')).toBe(40);
  });

  test('excludes commands with zero score', () => {
    const usage = new Map<string, number[]>();
    usage.set('recent', [now - 1 * HOUR]);
    usage.set('expired', [now - 31 * DAY]);

    const scores = computeAllFrecencyScores(usage, now);
    expect(scores.has('recent')).toBe(true);
    expect(scores.has('expired')).toBe(false);
  });
});

describe('getMaxFrecencyScore', () => {
  test('returns the highest score', () => {
    const scores = new Map([
      ['a', 100],
      ['b', 300],
      ['c', 50],
    ]);
    expect(getMaxFrecencyScore(scores)).toBe(300);
  });

  test('returns 0 for empty map', () => {
    expect(getMaxFrecencyScore(new Map())).toBe(0);
  });
});

describe('createRankedFilter', () => {
  const mockFuzzy = (value: string, search: string): number => {
    if (search.length === 0) return 1;
    return value.toLowerCase().includes(search.toLowerCase()) ? 10 : 0;
  };

  test('boosts matching results by frécency', () => {
    const scores = new Map([
      ['Build CLI', 100],
      ['Build Webapp', 50],
    ]);
    const filter = createRankedFilter(mockFuzzy, scores);

    const scoreCli = filter('Build CLI', 'build');
    const scoreWebapp = filter('Build Webapp', 'build');

    // Both match, but CLI has higher frécency → higher score
    expect(scoreCli).toBeGreaterThan(scoreWebapp);
  });

  test('respects fuzzy filter no-match', () => {
    const scores = new Map([['Build CLI', 100]]);
    const filter = createRankedFilter(mockFuzzy, scores);

    expect(filter('Build CLI', 'xyz')).toBe(0);
  });

  test('with empty search, orders by frécency', () => {
    const scores = new Map([
      ['Rarely Used', 10],
      ['Often Used', 200],
    ]);
    const filter = createRankedFilter(mockFuzzy, scores);

    const rarely = filter('Rarely Used', '');
    const often = filter('Often Used', '');

    expect(often).toBeGreaterThan(rarely);
  });

  test('commands without frécency still appear', () => {
    const scores = new Map([['Known', 100]]);
    const filter = createRankedFilter(mockFuzzy, scores);

    const result = filter('Unknown Command', '');
    expect(result).toBeGreaterThan(0); // Still shown
  });
});
