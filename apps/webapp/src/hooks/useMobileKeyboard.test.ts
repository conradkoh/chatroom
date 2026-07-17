import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeKeyboardInsetPx, useEditableElementFocused } from './useMobileKeyboard';

describe('useEditableElementFocused', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.focus();
  });

  it('returns false when nothing focused', () => {
    document.body.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns true for focused textarea', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(true);
  });

  it('returns false for readonly textarea', () => {
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    document.body.appendChild(ta);
    ta.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns true for focused text input', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(true);
  });

  it('returns false for readonly input', () => {
    const input = document.createElement('input');
    input.readOnly = true;
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns false for disabled input', () => {
    const input = document.createElement('input');
    input.disabled = true;
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns false for checkbox input', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns false for hidden input', () => {
    const input = document.createElement('input');
    input.type = 'hidden';
    document.body.appendChild(input);
    input.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns true for contenteditable element', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(true);
  });

  it('returns false for non-editable div', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();
    const { result } = renderHook(() => useEditableElementFocused(true));
    expect(result.current).toBe(false);
  });

  it('returns false when disabled via enabled=false', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const { result } = renderHook(() => useEditableElementFocused(false));
    expect(result.current).toBe(false);
  });
});

describe('computeKeyboardInsetPx', () => {
  const originalClientHeight = document.documentElement.clientHeight;

  beforeEach(() => {
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    delete window.__MOBILE_KEYBOARD_TEST_INSET__;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: originalClientHeight,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined,
    });
  });

  it('returns 0 when visualViewport is not available', () => {
    expect(computeKeyboardInsetPx()).toBe(0);
  });

  it('returns 0 when vv.height equals layout height and offsetTop is 0', () => {
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
    expect(computeKeyboardInsetPx()).toBe(320);
  });

  it('uses __MOBILE_KEYBOARD_TEST_INSET__ override when set', () => {
    window.__MOBILE_KEYBOARD_TEST_INSET__ = 280;
    expect(computeKeyboardInsetPx()).toBe(280);
    delete window.__MOBILE_KEYBOARD_TEST_INSET__;
  });

  it('clamps negative results to 0', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 900, offsetTop: 0 },
    });
    expect(computeKeyboardInsetPx()).toBe(0);
  });
});
