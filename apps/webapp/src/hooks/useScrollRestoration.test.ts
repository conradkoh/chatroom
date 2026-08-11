import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollRestoration } from './useScrollRestoration';

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn(() => '/app'),
}));

vi.mock('next/navigation', () => ({
  usePathname,
}));

describe('useScrollRestoration', () => {
  let container: HTMLDivElement;
  let rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    sessionStorage.clear();
    usePathname.mockReturnValue('/app');
    rafCallback = null;

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallback = callback;
      return 1;
    });

    container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', {
      writable: true,
      value: 0,
    });
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('sets scrollTop to 0 on forward pathname change', () => {
    container.scrollTop = 250;
    const ref = { current: container };

    const { rerender } = renderHook(() => useScrollRestoration(ref, 'main'));
    container.scrollTop = 250;

    usePathname.mockReturnValue('/app/admin/invites');
    rerender();

    expect(container.scrollTop).toBe(0);
  });

  it('restores scrollTop from sessionStorage after popstate', () => {
    sessionStorage.setItem('scroll-pos:/app/admin/invites:main', '420');
    const ref = { current: container };

    const { rerender } = renderHook(() => useScrollRestoration(ref, 'main'));

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    usePathname.mockReturnValue('/app/admin/invites');
    rerender();

    act(() => {
      rafCallback?.(0);
    });

    expect(container.scrollTop).toBe(420);
  });

  it('saves scrollTop to sessionStorage on pathname change cleanup', () => {
    const ref = { current: container };

    const { rerender } = renderHook(() => useScrollRestoration(ref, 'main'));
    container.scrollTop = 180;

    usePathname.mockReturnValue('/app/profile');
    rerender();

    expect(sessionStorage.getItem('scroll-pos:/app:main')).toBe('180');
  });

  it('saves independently per regionId on the same pathname', () => {
    const rootContainer = document.createElement('div');
    const contentContainer = document.createElement('div');
    Object.defineProperty(rootContainer, 'scrollTop', { writable: true, value: 0 });
    Object.defineProperty(contentContainer, 'scrollTop', { writable: true, value: 0 });
    document.body.appendChild(rootContainer);
    document.body.appendChild(contentContainer);

    const rootRef = { current: rootContainer };
    const contentRef = { current: contentContainer };

    const { rerender: rerenderRoot } = renderHook(() => useScrollRestoration(rootRef, 'root'));
    const { rerender: rerenderContent } = renderHook(() =>
      useScrollRestoration(contentRef, 'content')
    );

    rootContainer.scrollTop = 0;
    contentContainer.scrollTop = 420;

    usePathname.mockReturnValue('/app/admin/invites');
    rerenderRoot();
    rerenderContent();

    expect(sessionStorage.getItem('scroll-pos:/app:root')).toBe('0');
    expect(sessionStorage.getItem('scroll-pos:/app:content')).toBe('420');
  });
});
