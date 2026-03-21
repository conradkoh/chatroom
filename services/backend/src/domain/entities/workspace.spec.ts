/**
 * Unit tests for Workspace entity helpers
 */

import { describe, expect, test } from 'vitest';

import { isActiveWorkspace } from './workspace';

describe('isActiveWorkspace', () => {
  test('returns true when removedAt is undefined', () => {
    expect(isActiveWorkspace(undefined)).toBe(true);
  });

  test('returns false when removedAt is set to a timestamp', () => {
    expect(isActiveWorkspace(1700000000000)).toBe(false);
  });

  test('returns false when removedAt is 0', () => {
    expect(isActiveWorkspace(0)).toBe(false);
  });
});
