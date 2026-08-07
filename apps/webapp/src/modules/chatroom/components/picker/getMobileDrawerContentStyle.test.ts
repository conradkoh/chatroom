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

  it('sets height without top positioning when keyboard open and offsetTop is 0', () => {
    const style = getMobileDrawerContentStyle(300, 0);
    expect(style.maxHeight).toContain('300px');
    expect(style.maxHeight).not.toContain('120px');
    expect(style.top).toBeUndefined();
    expect(style.marginTop).toBeUndefined();
    expect(style.bottom).toBeUndefined();
  });

  it('top-anchors drawer and subtracts offsetTop from height when keyboard open', () => {
    const style = getMobileDrawerContentStyle(300, 120);
    expect(style.top).toContain('120px');
    expect(style.bottom).toBe('auto');
    expect(style.marginTop).toBe(0);
    expect(style.maxHeight).toContain('300px');
    expect(style.maxHeight).toContain('120px');
    expect(style.height).toBe(style.maxHeight);
    expect(style.overflow).toBe('hidden');
  });
});
