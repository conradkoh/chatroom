import { describe, expect, it } from 'vitest';

import { teamSupportsEnhancer } from './teamEnhancerSupport';

describe('teamSupportsEnhancer', () => {
  it('returns true when planner is in team roles', () => {
    expect(teamSupportsEnhancer('duo', ['planner', 'builder'])).toBe(true);
  });

  it('returns true for a solo team', () => {
    expect(teamSupportsEnhancer('solo', ['solo'])).toBe(true);
  });

  it('returns false when no supported entry-point role is present', () => {
    expect(teamSupportsEnhancer('duo', ['builder', 'reviewer'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(teamSupportsEnhancer('Duo', ['Planner'])).toBe(true);
    expect(teamSupportsEnhancer('Solo', ['Solo'])).toBe(true);
  });

  it('returns false for an unsupported team even when it has a planner role', () => {
    expect(teamSupportsEnhancer('squad', ['planner'])).toBe(false);
  });
});
