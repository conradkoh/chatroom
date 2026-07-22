import { describe, it, expect } from 'vitest';

import { compareSemver, isRemoteVersionNewer } from './semver.js';

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.72.0', '1.72.0')).toBe(0);
    expect(compareSemver('v1.72.0', '1.72.0')).toBe(0);
  });

  it('compares major versions', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0);
  });

  it('compares minor and patch versions', () => {
    expect(compareSemver('1.71.0', '1.72.0')).toBeLessThan(0);
    expect(compareSemver('1.72.1', '1.72.0')).toBeGreaterThan(0);
  });

  it('throws for invalid versions', () => {
    expect(() => compareSemver('not-a-version', '1.0.0')).toThrow(/Invalid semver/);
  });
});

describe('isRemoteVersionNewer', () => {
  it('returns true when remote is newer', () => {
    expect(isRemoteVersionNewer('1.71.0', '1.72.0')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isRemoteVersionNewer('1.72.0', '1.72.0')).toBe(false);
  });

  it('returns false when local is newer', () => {
    expect(isRemoteVersionNewer('1.73.0', '1.72.0')).toBe(false);
  });
});
