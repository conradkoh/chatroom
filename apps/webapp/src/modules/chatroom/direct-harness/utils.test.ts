import { describe, it, expect } from 'vitest';

import { relativeTime } from './utils';

describe('relativeTime', () => {
  it('returns "just now" for diff < 60 seconds', () => {
    const ts = Date.now() - 30_000; // 30s ago
    expect(relativeTime(ts)).toBe('just now');
  });

  it('returns "Xm ago" for diff between 1 and 59 minutes', () => {
    const ts = Date.now() - 5 * 60_000; // 5 minutes ago
    expect(relativeTime(ts)).toBe('5m ago');
  });

  it('returns "Xh ago" for diff between 1 and 23 hours', () => {
    const ts = Date.now() - 3 * 3_600_000; // 3 hours ago
    expect(relativeTime(ts)).toBe('3h ago');
  });

  it('returns "Xd ago" for diff >= 1 day', () => {
    const ts = Date.now() - 2 * 86_400_000; // 2 days ago
    expect(relativeTime(ts)).toBe('2d ago');
  });
});
