import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeKeyboardInsetPx } from './useVisualViewportKeyboardInset';

describe('computeKeyboardInsetPx', () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    delete window.__PICKER_TEST_KEYBOARD_INSET__;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined,
    });
  });

  it('returns 0 when visualViewport is not available', () => {
    // Ensure neither property is set
    expect(computeKeyboardInsetPx()).toBe(0);
  });

  it('returns 0 when vv.height equals innerHeight and offsetTop is 0', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 800, offsetTop: 0 },
    });
    expect(computeKeyboardInsetPx()).toBe(0);
  });

  it('returns positive inset when keyboard is visible', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 500, offsetTop: 0 },
    });
    expect(computeKeyboardInsetPx()).toBe(300);
  });

  it('accounts for offsetTop', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 450, offsetTop: 30 },
    });
    // innerHeight=800 - vv.height=450 - offsetTop=30 = 320
    expect(computeKeyboardInsetPx()).toBe(320);
  });

  it('uses __PICKER_TEST_KEYBOARD_INSET__ override when set', () => {
    window.__PICKER_TEST_KEYBOARD_INSET__ = 280;
    expect(computeKeyboardInsetPx()).toBe(280);
    delete window.__PICKER_TEST_KEYBOARD_INSET__;
  });

  it('clamps negative results to 0', () => {
    // Scenario where keyboard is closing and vv expands past innerHeight briefly
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 900, offsetTop: 0 },
    });
    expect(computeKeyboardInsetPx()).toBe(0);
  });
});
