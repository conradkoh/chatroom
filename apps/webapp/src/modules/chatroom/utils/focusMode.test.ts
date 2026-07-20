import { describe, expect, test } from 'vitest';

import { isFocusModeActive } from './focusMode';

describe('isFocusModeActive', () => {
  test('returns true when both sidebars are hidden', () => {
    expect(isFocusModeActive(false, false)).toBe(true);
  });

  test('returns false when listing is visible', () => {
    expect(isFocusModeActive(true, false)).toBe(false);
  });

  test('returns false when agents is visible', () => {
    expect(isFocusModeActive(false, true)).toBe(false);
  });

  test('returns false when both are visible', () => {
    expect(isFocusModeActive(true, true)).toBe(false);
  });
});
