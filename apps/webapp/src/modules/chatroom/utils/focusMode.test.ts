import { describe, expect, test } from 'vitest';

import { isFocusModeActive, isListingSidebarVisible } from './focusMode';

describe('isListingSidebarVisible', () => {
  test('returns true when focus mode is disabled', () => {
    expect(isListingSidebarVisible(false)).toBe(true);
  });

  test('returns false when focus mode is enabled', () => {
    expect(isListingSidebarVisible(true)).toBe(false);
  });
});

describe('isFocusModeActive', () => {
  test('returns true when focus mode is enabled', () => {
    expect(isFocusModeActive(true)).toBe(true);
  });

  test('returns false when focus mode is disabled', () => {
    expect(isFocusModeActive(false)).toBe(false);
  });
});
