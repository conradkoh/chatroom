import { describe, expect, test } from 'vitest';

import { isScrollAtBottom } from './isScrollAtBottom';

function mockElement(
  overrides: Partial<{ scrollHeight: number; scrollTop: number; clientHeight: number }>
): HTMLElement {
  return { scrollHeight: 1000, scrollTop: 0, clientHeight: 600, ...overrides } as HTMLElement;
}

describe('isScrollAtBottom', () => {
  test('returns true when scrolled to bottom exactly', () =>
    expect(isScrollAtBottom(mockElement({ scrollTop: 400 }))).toBe(true));
  test('returns true within default threshold', () =>
    expect(isScrollAtBottom(mockElement({ scrollTop: 360 }))).toBe(true));
  test('returns false when far from bottom', () =>
    expect(isScrollAtBottom(mockElement({ scrollTop: 0 }))).toBe(false));
  test('respects custom threshold', () => {
    const el = mockElement({ scrollTop: 250 });
    expect(isScrollAtBottom(el, 200)).toBe(true);
    expect(isScrollAtBottom(el, 100)).toBe(false);
  });
  test('handles empty content', () =>
    expect(isScrollAtBottom(mockElement({ scrollHeight: 600 }))).toBe(true));
});
