import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isExplorerTabCloseShortcut,
  isAppNavigationTarget,
  useExplorerTabCloseShortcut,
} from './useExplorerTabCloseShortcut';

describe('isExplorerTabCloseShortcut', () => {
  it('returns true for Meta+W', () => {
    expect(
      isExplorerTabCloseShortcut(new KeyboardEvent('keydown', { key: 'w', metaKey: true }))
    ).toBe(true);
  });

  it('returns true for Ctrl+W', () => {
    expect(
      isExplorerTabCloseShortcut(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }))
    ).toBe(true);
  });

  it('returns false for plain W (no modifier)', () => {
    expect(isExplorerTabCloseShortcut(new KeyboardEvent('keydown', { key: 'w' }))).toBe(false);
  });

  it('returns false for Meta+Shift+W', () => {
    expect(
      isExplorerTabCloseShortcut(
        new KeyboardEvent('keydown', { key: 'w', metaKey: true, shiftKey: true })
      )
    ).toBe(false);
  });

  it('returns false for Meta+Alt+W', () => {
    expect(
      isExplorerTabCloseShortcut(
        new KeyboardEvent('keydown', { key: 'w', metaKey: true, altKey: true })
      )
    ).toBe(false);
  });

  it('returns false for Meta+Q', () => {
    expect(
      isExplorerTabCloseShortcut(new KeyboardEvent('keydown', { key: 'q', metaKey: true }))
    ).toBe(false);
  });
});

describe('isAppNavigationTarget', () => {
  it('returns true when target is inside [data-app-navigation]', () => {
    const nav = document.createElement('header');
    nav.setAttribute('data-app-navigation', '');
    const child = document.createElement('span');
    nav.appendChild(child);
    expect(isAppNavigationTarget(child)).toBe(true);
  });

  it('returns true when target is the navigation element itself', () => {
    const nav = document.createElement('header');
    nav.setAttribute('data-app-navigation', '');
    expect(isAppNavigationTarget(nav)).toBe(true);
  });

  it('returns false when target is outside navigation', () => {
    const div = document.createElement('div');
    expect(isAppNavigationTarget(div)).toBe(false);
  });

  it('returns false for null or non-Element target', () => {
    expect(isAppNavigationTarget(null)).toBe(false);
    expect(isAppNavigationTarget(document.createTextNode('text'))).toBe(false);
  });
});

describe('useExplorerTabCloseShortcut', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onCloseTab with activeTabKey on Meta+W when enabled', () => {
    const onCloseTab = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() =>
      useExplorerTabCloseShortcut({ enabled: true, activeTabKey: 'tab-1', onCloseTab })
    );

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    handler(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onCloseTab).toHaveBeenCalledWith('tab-1');
  });

  it('does not call onCloseTab when disabled', () => {
    const onCloseTab = vi.fn();

    renderHook(() =>
      useExplorerTabCloseShortcut({ enabled: false, activeTabKey: 'tab-1', onCloseTab })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true }));

    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it('does not call onCloseTab when document.activeElement is inside navigation', () => {
    const onCloseTab = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() =>
      useExplorerTabCloseShortcut({ enabled: true, activeTabKey: 'tab-1', onCloseTab })
    );

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const nav = document.createElement('header');
    nav.setAttribute('data-app-navigation', '');
    nav.tabIndex = -1;
    document.body.appendChild(nav);
    nav.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: document.body });
    handler(event);

    expect(onCloseTab).not.toHaveBeenCalled();
    document.body.removeChild(nav);
  });

  it('does not call onCloseTab when event target is inside navigation', () => {
    const onCloseTab = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() =>
      useExplorerTabCloseShortcut({ enabled: true, activeTabKey: 'tab-1', onCloseTab })
    );

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const nav = document.createElement('header');
    nav.setAttribute('data-app-navigation', '');
    const child = document.createElement('button');
    nav.appendChild(child);

    const event = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: child });

    handler(event);

    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it('does not call onCloseTab when activeTabKey is null', () => {
    const onCloseTab = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() =>
      useExplorerTabCloseShortcut({ enabled: true, activeTabKey: null, onCloseTab })
    );

    const handler = addSpy.mock.calls.find((call) => call[0] === 'keydown')?.[1] as (
      event: KeyboardEvent
    ) => void;

    const event = new KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true });
    handler(event);

    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it('cleans up event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useExplorerTabCloseShortcut({ enabled: true, activeTabKey: 'tab-1', onCloseTab: vi.fn() })
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
  });
});
