import { describe, expect, it } from 'vitest';

import {
  getEffectiveMaxTextareaHeightPx,
  MAX_TEXTAREA_HEIGHT_PX,
  measureTextareaContentHeightPx,
} from './messageInputAutosize';

describe('getEffectiveMaxTextareaHeightPx', () => {
  it('uses full line cap on tall viewports', () => {
    // 50% of 1000px = 500px > 432px cap
    expect(getEffectiveMaxTextareaHeightPx(1000)).toBe(MAX_TEXTAREA_HEIGHT_PX);
  });

  it('limits height to 50% of viewport on small screens', () => {
    // iPhone SE-ish: 667px * 0.5 = 333px < 432px
    expect(getEffectiveMaxTextareaHeightPx(667)).toBe(Math.floor(667 * 0.5));
  });

  it('falls back to line cap when viewport height is unknown', () => {
    expect(getEffectiveMaxTextareaHeightPx(0)).toBe(MAX_TEXTAREA_HEIGHT_PX);
  });

  it('shrinks when mobile keyboard reduces visual viewport', () => {
    // Keyboard open: visual viewport ~300px
    expect(getEffectiveMaxTextareaHeightPx(300)).toBe(150);
  });
});

describe('measureTextareaContentHeightPx', () => {
  it('returns scroll height capped by max', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'line one\nline two';
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => 80,
    });

    expect(measureTextareaContentHeightPx(textarea, 60)).toBe(60);
    expect(textarea.style.height).toBe('0px');
  });
});
