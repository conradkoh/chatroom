import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isEditableTarget, isMacOS, MacPageNavigation } from './MacPageNavigation';

const back = vi.fn();
const forward = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back, forward }),
}));

function setPlatform({ platform, userAgent }: { platform: string; userAgent: string }) {
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}

function pressKey(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  const preventDefault = vi.spyOn(event, 'preventDefault');
  target.dispatchEvent(event);
  return { event, preventDefault };
}

describe('MacPageNavigation', () => {
  beforeEach(() => {
    back.mockClear();
    forward.mockClear();
    setPlatform({ platform: 'MacIntel', userAgent: 'Mac OS X' });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('macOS Ctrl+ArrowLeft calls back and prevents default', () => {
    const { unmount } = render(<MacPageNavigation />);
    const { preventDefault } = pressKey(window, { key: 'ArrowLeft', ctrlKey: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('macOS Ctrl+ArrowRight calls forward and prevents default', () => {
    const { unmount } = render(<MacPageNavigation />);
    const { preventDefault } = pressKey(window, { key: 'ArrowRight', ctrlKey: true });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not navigate on non-macOS', () => {
    setPlatform({ platform: 'Win32', userAgent: 'Windows NT' });
    const { unmount } = render(<MacPageNavigation />);
    pressKey(window, { key: 'ArrowLeft', ctrlKey: true });
    pressKey(window, { key: 'ArrowRight', ctrlKey: true });
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    unmount();
  });

  it('does not navigate from input, textarea, or contenteditable targets', () => {
    const { unmount } = render(<MacPageNavigation />);
    for (const tag of ['input', 'textarea', 'select'] as const) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      pressKey(el, { key: 'ArrowLeft', ctrlKey: true });
      el.remove();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    pressKey(editable, { key: 'ArrowLeft', ctrlKey: true });
    editable.remove();
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    unmount();
  });

  it('does not navigate with extra modifiers or already-default-prevented events', () => {
    const { unmount } = render(<MacPageNavigation />);
    pressKey(window, { key: 'ArrowLeft', ctrlKey: true, metaKey: true });
    pressKey(window, { key: 'ArrowLeft', ctrlKey: true, altKey: true });
    pressKey(window, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true });
    pressKey(window, { key: 'ArrowLeft' });
    const prevented = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowLeft',
      ctrlKey: true,
    });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    unmount();
  });

  it('removes the listener on unmount', () => {
    const { unmount } = render(<MacPageNavigation />);
    unmount();
    pressKey(window, { key: 'ArrowLeft', ctrlKey: true });
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('isMacOS', () => {
  it('matches macOS platform or user agent', () => {
    setPlatform({ platform: 'MacIntel', userAgent: 'Mac OS X' });
    expect(isMacOS()).toBe(true);
    setPlatform({ platform: 'Win32', userAgent: 'Windows NT' });
    expect(isMacOS()).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('detects editable elements and ignores plain targets', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
