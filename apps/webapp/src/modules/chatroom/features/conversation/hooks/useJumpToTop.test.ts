import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useJumpToTop } from './useJumpToTop';

function makeScrollEl(scrollTop: number, reduceMotion = false) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.tabIndex = -1;
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, 'scrollTo', { value: vi.fn(), configurable: true });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduceMotion && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return el;
}

/** Simulate a native scroll to `top` (what the browser does, then fires `scroll`). */
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
}

function setup(
  initialTop: number,
  options: { enabled?: boolean; resetKey?: string | null; reduceMotion?: boolean } = {}
) {
  const el = makeScrollEl(initialTop, options.reduceMotion);
  const containerRef = { current: el };
  const hook = renderHook(
    (props: { resetKey: string | null; enabled: boolean }) =>
      useJumpToTop({ containerRef, enabled: props.enabled, resetKey: props.resetKey }),
    { initialProps: { resetKey: options.resetKey ?? 'a1', enabled: options.enabled ?? true } }
  );
  return { el, containerRef, ...hook };
}

const attachedElements: HTMLElement[] = [];

function trackedSetup(
  initialTop: number,
  options: { enabled?: boolean; resetKey?: string | null; reduceMotion?: boolean } = {}
) {
  const result = setup(initialTop, options);
  attachedElements.push(result.el);
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  attachedElements.splice(0).forEach((el) => el.remove());
});

describe('useJumpToTop', () => {
  it('hidden initially', () => {
    const { result } = trackedSetup(1000);
    expect(result.current.isVisible).toBe(false);
  });

  it('shows after 80px of accumulated upward scroll below the near-top band (ends above 200)', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);
  });

  it('does not show for 50px upward scroll', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 950));
    expect(result.current.isVisible).toBe(false);
  });

  it('accumulates small upward steps', () => {
    const { el, result } = trackedSetup(1000);
    act(() => {
      scrollTo(el, 960);
      scrollTo(el, 940);
      scrollTo(el, 920);
    });
    expect(result.current.isVisible).toBe(true);
  });

  it('does not show when the upward movement ends at scrollTop <= 200', () => {
    const { el, result } = trackedSetup(250);
    act(() => scrollTo(el, 150));
    expect(result.current.isVisible).toBe(false);
  });

  it('does not show on a short feed', () => {
    const { el, result } = trackedSetup(0);
    act(() => scrollTo(el, 0));
    expect(result.current.isVisible).toBe(false);
  });

  it('auto-hides 3000 ms after the last upward movement', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isVisible).toBe(false);
  });

  it('further upward scrolling re-arms the timer', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => scrollTo(el, 900));
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.isVisible).toBe(false);
  });

  it('hides after 40px of downward scroll', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => scrollTo(el, 930));
    expect(result.current.isVisible).toBe(true);

    act(() => scrollTo(el, 960));
    expect(result.current.isVisible).toBe(false);
  });

  it('hides when the feed returns to near-top', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => scrollTo(el, 200));
    expect(result.current.isVisible).toBe(false);
  });

  it('hover/focus pauses and never hides', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.pause());
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.resume());
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isVisible).toBe(false);
  });

  it('resume does not show a hidden button', () => {
    const { result } = trackedSetup(1000);
    act(() => result.current.pause());
    act(() => result.current.resume());
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.isVisible).toBe(false);
  });

  it('hides when the anchor changes', () => {
    const { el, result, rerender } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    rerender({ resetKey: 'a2', enabled: true });
    expect(result.current.isVisible).toBe(false);
  });

  it('does not attach while disabled (empty feed)', () => {
    const { el, result } = trackedSetup(1000, { enabled: false });
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(false);
  });

  it('hides when the feed becomes disabled (empty) and does not resurrect', () => {
    const { el, result, rerender } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    rerender({ resetKey: 'a1', enabled: false });
    expect(result.current.isVisible).toBe(false);

    rerender({ resetKey: 'a1', enabled: true });
    expect(result.current.isVisible).toBe(false);
  });

  it('click scrolls to top smoothly, hides, and focuses the list', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(result.current.isVisible).toBe(false);
    expect(document.activeElement).toBe(el);
  });

  it('click uses instant scroll under reduced motion', () => {
    const { el, result } = trackedSetup(1000, { reduceMotion: true });
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('does not re-show during the smooth scroll', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());
    act(() => {
      scrollTo(el, 900);
      scrollTo(el, 800);
      scrollTo(el, 700);
    });

    expect(result.current.isVisible).toBe(false);
  });

  it('a wheel gesture releases suppression', () => {
    const { el, result } = trackedSetup(1000);
    act(() => scrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());
    act(() => scrollTo(el, 900));
    expect(result.current.isVisible).toBe(false);

    act(() => {
      el.dispatchEvent(new Event('wheel'));
    });
    act(() => {
      scrollTo(el, 800);
      scrollTo(el, 700);
    });

    expect(result.current.isVisible).toBe(true);
  });
});
