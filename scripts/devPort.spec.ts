import { describe, expect, it } from 'bun:test';

import {
  BLACKLISTED_DEV_PORTS,
  MAX_DEV_PORT,
  MIN_DEV_PORT,
  generateRandomDevPort,
  isBlacklistedDevPort,
  isValidDevPort,
  pickRandomPortInRange,
} from './devPort';

describe('isBlacklistedDevPort', () => {
  it('returns true for known dev/service ports', () => {
    expect(isBlacklistedDevPort(3000)).toBe(true);
    expect(isBlacklistedDevPort(5173)).toBe(true);
    expect(isBlacklistedDevPort(5432)).toBe(true);
  });

  it('returns false for ephemeral ports not in blacklist', () => {
    expect(isBlacklistedDevPort(50000)).toBe(false);
  });
});

describe('isValidDevPort', () => {
  it('accepts ephemeral range bounds', () => {
    expect(isValidDevPort(MIN_DEV_PORT)).toBe(true);
    expect(isValidDevPort(MAX_DEV_PORT)).toBe(true);
    expect(isValidDevPort(50000)).toBe(true);
  });

  it('rejects below min, above max, and legacy low ports', () => {
    expect(isValidDevPort(MIN_DEV_PORT - 1)).toBe(false);
    expect(isValidDevPort(MAX_DEV_PORT + 1)).toBe(false);
    expect(isValidDevPort(3000)).toBe(false);
  });
});

describe('pickRandomPortInRange', () => {
  it('returns port when candidate is not rejected', () => {
    const port = pickRandomPortInRange(
      50000,
      50000,
      () => false,
      () => 0
    );
    expect(port).toBe(50000);
  });

  it('throws after max attempts when every candidate is rejected', () => {
    expect(() =>
      pickRandomPortInRange(
        50000,
        50000,
        () => true,
        () => 0,
        3
      )
    ).toThrow(/Failed to generate port after 3 attempts/);
  });
});

describe('generateRandomDevPort', () => {
  it('returns MIN_DEV_PORT when random is 0', () => {
    expect(generateRandomDevPort(() => 0)).toBe(MIN_DEV_PORT);
  });

  it('returns MAX_DEV_PORT when random approaches 1', () => {
    expect(generateRandomDevPort(() => 0.999999)).toBe(MAX_DEV_PORT);
  });

  it('returns only in-range, non-blacklisted ports over many samples', () => {
    for (let i = 0; i < 200; i++) {
      const port = generateRandomDevPort();
      expect(isValidDevPort(port)).toBe(true);
      expect(BLACKLISTED_DEV_PORTS.has(port)).toBe(false);
    }
  });
});
