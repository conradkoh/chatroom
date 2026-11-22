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

type UserInput = 'wheel' | 'touchmove' | 'keydown' | 'pointerdown';

/** Browser-driven scroll: no user input. Use only for the cases that must NOT count. */
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
}

/** A user scroll: the input event first (what the user did), then the scroll it caused. */
function userScrollTo(el: HTMLElement, top: number, via: UserInput = 'wheel') {
  el.dispatchEvent(new Event(via));
  scrollTo(el, top);
  if (via === 'pointerdown') window.dispatchEvent(new Event('pointerup'));
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

  it('shows after 80px of accumulated user upward scroll below the near-top band (ends above 200)', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);
  });

  it('does not show for 50px upward scroll', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 950));
    expect(result.current.isVisible).toBe(false);
  });

  it('accumulates small upward steps', () => {
    const { el, result } = trackedSetup(1000);
    act(() => {
      userScrollTo(el, 960);
      userScrollTo(el, 940);
      userScrollTo(el, 920);
    });
    expect(result.current.isVisible).toBe(true);
  });

  it('does not show when the upward movement ends at scrollTop <= 200', () => {
    const { el, result } = trackedSetup(250);
    act(() => userScrollTo(el, 150));
    expect(result.current.isVisible).toBe(false);
  });

  it('a feed that shrinks to non-scrollable never shows the button', () => {
    const { el, result } = trackedSetup(1000);
    // Previously long feed (lastTop 1000) is now short: clientHeight equals scrollHeight.
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 400, configurable: true });
    act(() => userScrollTo(el, 0)); // browser clamps scrollTop to 0 after the user's wheel
    expect(result.current.isVisible).toBe(false);
  });
  // Would show without the near-top guard (upward 1000 px from a user wheel).

  it('a container resize that clamps scrollTop upward does not show the button', () => {
    const { el, result } = trackedSetup(1000);
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true }); // composer shrinks, feed grows
    act(() => scrollTo(el, 920)); // browser clamp, no user input
    expect(result.current.isVisible).toBe(false);
  });

  it('scroll anchoring above the viewport does not show the button', () => {
    const { el, result } = trackedSetup(1000);
    Object.defineProperty(el, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 2920, configurable: true }); // content above shrank
    act(() => scrollTo(el, 920)); // anchoring adjusts scrollTop, no user input
    expect(result.current.isVisible).toBe(false);
  });

  it.each<UserInput>(['wheel', 'touchmove', 'keydown', 'pointerdown'])(
    'a user %s upward scroll shows the button',
    (via) => {
      const { el, result } = trackedSetup(1000);
      act(() => userScrollTo(el, 920, via));
      expect(result.current.isVisible).toBe(true);
    }
  );

  it('a scrollbar drag (pointer held beyond the input window) shows the button', () => {
    const { el, result } = trackedSetup(1000);
    act(() => {
      el.dispatchEvent(new Event('pointerdown'));
      scrollTo(el, 960);
    });
    act(() => {
      vi.advanceTimersByTime(1000); // longer than the input window; the pointer is still held
      scrollTo(el, 920);
    });
    expect(result.current.isVisible).toBe(true);
    act(() => window.dispatchEvent(new Event('pointerup')));
  });

  it('upward movement after the input window closes does not count', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 960));
    act(() => vi.advanceTimersByTime(300));
    act(() => scrollTo(el, 920)); // 40 + 40 would show if the second step counted
    expect(result.current.isVisible).toBe(false);
  });

  it('a programmatic jump to the bottom hides the button without user input', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);
    act(() => scrollTo(el, 1000)); // "Jump to new messages": downward 80 px, no input
    expect(result.current.isVisible).toBe(false);
  });

  it('auto-hides 3000 ms after the last upward movement', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
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
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => userScrollTo(el, 900));
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
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => userScrollTo(el, 930));
    expect(result.current.isVisible).toBe(true);

    act(() => userScrollTo(el, 960));
    expect(result.current.isVisible).toBe(false);
  });

  it('hides when the feed returns to near-top', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => scrollTo(el, 200));
    expect(result.current.isVisible).toBe(false);
  });

  it('hover/focus pauses and never hides', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
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

  it('hover and focus holds are counted separately; the timer waits for both to release', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    act(() => result.current.pause()); // mouseEnter
    act(() => result.current.pause()); // focus
    act(() => result.current.resume()); // mouseLeave
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.isVisible).toBe(true); // still focused
    act(() => result.current.resume()); // blur
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.isVisible).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isVisible).toBe(false);
  });

  it('hiding while held resets the holds so the next appearance still auto-hides', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    act(() => result.current.pause()); // hovered
    act(() => userScrollTo(el, 960)); // 40 px down hides it while hovered
    expect(result.current.isVisible).toBe(false);
    act(() => result.current.resume()); // mouseLeave after unmount (no-op, clamped)
    act(() => userScrollTo(el, 880)); // 80 px up again
    expect(result.current.isVisible).toBe(true);
    act(() => vi.advanceTimersByTime(3000));
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
    act(() => userScrollTo(el, 920));
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
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    rerender({ resetKey: 'a1', enabled: false });
    expect(result.current.isVisible).toBe(false);

    rerender({ resetKey: 'a1', enabled: true });
    expect(result.current.isVisible).toBe(false);
  });

  it('click scrolls to top smoothly, hides, and focuses the list', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(result.current.isVisible).toBe(false);
    expect(document.activeElement).toBe(el);
  });

  it('click uses instant scroll under reduced motion', () => {
    const { el, result } = trackedSetup(1000, { reduceMotion: true });
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('does not re-show during the smooth scroll', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    expect(result.current.isVisible).toBe(true);

    act(() => result.current.jumpToTop());
    act(() => {
      scrollTo(el, 900);
      scrollTo(el, 800);
      scrollTo(el, 700);
    });

    expect(result.current.isVisible).toBe(false);
  });

  it.each<UserInput>(['wheel', 'touchmove', 'keydown', 'pointerdown'])(
    'after a click, a user %s releases suppression so a later upward scroll shows the button',
    (via) => {
      const { el, result } = trackedSetup(1000);
      act(() => userScrollTo(el, 920));
      act(() => result.current.jumpToTop()); // suppressed, hidden
      act(() => userScrollTo(el, 900, via));
      act(() => userScrollTo(el, 800, via));
      expect(result.current.isVisible).toBe(true);
    }
  );

  it('reaching near-top releases suppression; a later upward scroll shows the button again', () => {
    const { el, result } = trackedSetup(1000);
    act(() => userScrollTo(el, 920));
    act(() => result.current.jumpToTop());
    act(() => userScrollTo(el, 150)); // near-top: releases suppression
    act(() => userScrollTo(el, 500)); // down, stays hidden
    act(() => userScrollTo(el, 420)); // 80 px up, above the near-top band
    expect(result.current.isVisible).toBe(true);
  });
});
