import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceBottomBarShell } from './WorkspaceBottomBar';

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));

const LAYOUT_HEIGHT_PX = 800;
const KEYBOARD_PX = 300;
/** Shell's own settle window plus the hook's delayed rechecks (100 ms and 300 ms). */
const SETTLE_MS = 300;

type FakeVisualViewport = EventTarget & { height: number; offsetTop: number; scale: number };

let viewport: FakeVisualViewport;

beforeEach(() => {
  vi.useFakeTimers();
  viewport = Object.assign(new EventTarget(), {
    height: LAYOUT_HEIGHT_PX - KEYBOARD_PX, // keyboard open: visible height 500
    offsetTop: 0,
    scale: 1,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => LAYOUT_HEIGHT_PX,
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  delete (window as { visualViewport?: unknown }).visualViewport;
  delete (document.documentElement as { clientHeight?: number }).clientHeight;
});

function renderShellWithComposer() {
  const view = render(
    <>
      <div data-main-chat-composer="">
        <textarea data-testid="composer" />
      </div>
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    </>
  );
  return { ...view, composer: screen.getByTestId('composer') as HTMLTextAreaElement };
}

const transform = () => screen.getByTestId('workspace-bottom-bar').style.transform;

describe('WorkspaceBottomBarShell lift with a browser visualViewport', () => {
  it('lifts by the keyboard height once the composer is focused and the keyboard settles', () => {
    const { composer } = renderShellWithComposer();
    act(() => composer.focus());
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(transform()).toBe('translateY(-300px)');
  });

  it('keeps the lift when the browser pans the viewport after the keyboard settles', () => {
    const { composer } = renderShellWithComposer();
    act(() => composer.focus());
    act(() => vi.advanceTimersByTime(1000)); // well past the follow window
    act(() => {
      viewport.offsetTop = 120; // user pans the page up to reveal the header
      viewport.dispatchEvent(new Event('scroll'));
    });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(transform()).toBe('translateY(-300px)');
  });

  it('still follows a scroll that lands while the keyboard is settling (iOS scroll-into-view)', () => {
    const { composer } = renderShellWithComposer();
    act(() => composer.focus());
    act(() => {
      viewport.offsetTop = 40;
      viewport.dispatchEvent(new Event('scroll'));
    });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(transform()).toBe('translateY(-260px)');
  });

  it('re-lifts when the keyboard height changes', () => {
    const { composer } = renderShellWithComposer();
    act(() => composer.focus());
    act(() => vi.advanceTimersByTime(1000));
    act(() => {
      viewport.height = 450; // keyboard grew to 350px
      viewport.offsetTop = 120;
      viewport.dispatchEvent(new Event('resize'));
    });
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(transform()).toBe('translateY(-230px)');
  });

  it('clears the lift when the composer loses focus', () => {
    const { composer } = renderShellWithComposer();
    act(() => composer.focus());
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    act(() => composer.blur());
    act(() => vi.advanceTimersByTime(SETTLE_MS));
    expect(transform()).toBe('');
  });
});
