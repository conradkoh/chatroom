import { describe, expect, it } from 'vitest';

import { isModEnterKey } from './isModEnterKey';

describe('isModEnterKey', () => {
  it('returns true for Cmd+Enter', () => {
    expect(isModEnterKey({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true);
  });

  it('returns true for Ctrl+Enter', () => {
    expect(isModEnterKey({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true);
  });

  it('returns false for Enter alone', () => {
    expect(isModEnterKey({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false);
  });

  it('returns false for Cmd+A', () => {
    expect(isModEnterKey({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false);
  });

  it('returns false for Shift+Enter', () => {
    expect(isModEnterKey({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false);
  });
});
