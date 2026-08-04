import { describe, expect, it } from 'vitest';

import { teamSupportsEnhancer } from './teamEnhancerSupport';

describe('teamSupportsEnhancer', () => {
  it('returns true when planner is in team roles', () => {
    expect(teamSupportsEnhancer(['planner', 'builder'])).toBe(true);
  });

  it('returns false when planner is absent', () => {
    expect(teamSupportsEnhancer(['builder', 'reviewer'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(teamSupportsEnhancer(['Planner'])).toBe(true);
  });
});
