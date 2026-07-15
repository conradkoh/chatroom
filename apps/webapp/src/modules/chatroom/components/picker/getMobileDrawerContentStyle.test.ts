import { describe, expect, it } from 'vitest';

import { getMobileDrawerContentStyle } from './getMobileDrawerContentStyle';

describe('getMobileDrawerContentStyle', () => {
  it('includes safe-area horizontal padding when keyboard closed', () => {
    const style = getMobileDrawerContentStyle(0);
    expect(style.paddingLeft).toContain('safe-area-inset-left');
    expect(style.paddingRight).toContain('safe-area-inset-right');
    expect(style.paddingBottom).toContain('safe-area-inset-bottom');
  });

  it('adds keyboard inset to maxHeight and height when keyboard open', () => {
    const style = getMobileDrawerContentStyle(300);
    expect(style.paddingBottom).toContain('safe-area-inset-bottom');
    expect(style.paddingBottom).not.toContain('300px');
    expect(style.maxHeight).toContain('300px');
    expect(style.height).toBe(style.maxHeight);
    expect(style.overflow).toBe('hidden');
  });

  it('does not set maxHeight when keyboard closed', () => {
    const style = getMobileDrawerContentStyle(0);
    expect(style.maxHeight).toBeUndefined();
  });
});
