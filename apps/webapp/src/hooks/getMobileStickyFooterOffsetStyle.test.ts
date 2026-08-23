import { describe, expect, it } from 'vitest';

import { getMobileStickyFooterOffsetStyle } from './getMobileStickyFooterOffsetStyle';

describe('getMobileStickyFooterOffsetStyle', () => {
  it('returns empty object when inset is zero', () => {
    expect(getMobileStickyFooterOffsetStyle(0)).toEqual({});
  });

  it('returns translateY transform when inset is positive', () => {
    expect(getMobileStickyFooterOffsetStyle(280)).toEqual({
      transform: 'translateY(-280px)',
    });
  });
});
