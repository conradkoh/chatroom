import { describe, it, expect } from 'vitest';
import { isScrollAtTop } from './isScrollAtTop';

function mockElement(
  overrides: Partial<{ scrollHeight: number; scrollTop: number; clientHeight: number }>
) {
  return { scrollHeight: 1000, scrollTop: 0, clientHeight: 600, ...overrides } as HTMLElement;
}

describe('isScrollAtTop', () => {
  it('returns true when at top exactly', () => {
    expect(isScrollAtTop(mockElement({ scrollTop: 0 }))).toBe(true);
  });

  it('returns true within threshold', () => {
    expect(isScrollAtTop(mockElement({ scrollTop: 40 }))).toBe(true);
  });

  it('returns false when scrolled down past threshold', () => {
    expect(isScrollAtTop(mockElement({ scrollTop: 100 }))).toBe(false);
  });
});
