import { describe, expect, test } from 'vitest';
import { isScrollAtBottom } from './isScrollAtBottom';

function mockElement(
  overrides: Partial<{ scrollHeight: number; scrollTop: number; clientHeight: number }>
): HTMLElement {
  return { scrollHeight: 1000, scrollTop: 0, clientHeight: 600, ...overrides } as HTMLElement;
}

describe('isScrollAtBottom', () => {
  test('returns true when scrolled to bottom exactly', () => {
    const el = mockElement({ scrollTop: 400 });
    expect(isScrollAtBottom(el)).toBe(true);
  });

  test('returns true when within default threshold (48px) of bottom', () => {
    const el = mockElement({ scrollTop: 360 });
    expect(isScrollAtBottom(el)).toBe(true);
  });

  test('returns false when far from bottom', () => {
    const el = mockElement({ scrollTop: 0 });
    expect(isScrollAtBottom(el)).toBe(false);
  });

  test('respects custom threshold', () => {
    const el = mockElement({ scrollTop: 100 });
    expect(isScrollAtBottom(el, 200)).toBe(true);
    expect(isScrollAtBottom(el, 50)).toBe(false);
  });

  test('handles empty content (scrollHeight equals clientHeight)', () => {
    const el = mockElement({ scrollHeight: 600, scrollTop: 0, clientHeight: 600 });
    expect(isScrollAtBottom(el)).toBe(true);
  });
});
