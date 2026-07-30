import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { navigateWithAppPageTransition, resetAppPageTransitionForTests } from './appPageTransition';

function createMockRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  };
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList);
}

describe('navigateWithAppPageTransition', () => {
  beforeEach(() => {
    resetAppPageTransitionForTests();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    mockMatchMedia(false);
  });

  afterEach(() => {
    resetAppPageTransitionForTests();
    vi.restoreAllMocks();
  });

  it('calls router.push when no startViewTransition', () => {
    const router = createMockRouter();

    navigateWithAppPageTransition(router, '/app/chatroom?id=abc', 'forward');

    expect(router.push).toHaveBeenCalledWith('/app/chatroom?id=abc');
  });

  it('sets and clears dataset when VT exists', async () => {
    const router = createMockRouter();
    let finishResolve!: () => void;
    const finishPromise = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });

    const startVT = vi.fn((callback: () => void) => {
      callback();
      return { finished: finishPromise };
    });
    Object.defineProperty(document, 'startViewTransition', {
      value: startVT,
      writable: true,
      configurable: true,
    });

    navigateWithAppPageTransition(router, '/app', 'back');

    expect(document.documentElement.dataset.appPageTransition).toBe('back');
    expect(document.documentElement.dataset.appPageTransitionActive).toBe('true');
    expect(startVT).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/app');

    finishResolve();
    await finishPromise;

    expect(document.documentElement.dataset.appPageTransition).toBeUndefined();
    expect(document.documentElement.dataset.appPageTransitionActive).toBeUndefined();
  });

  it('skips VT when prefers-reduced-motion: reduce', () => {
    const router = createMockRouter();
    const startVT = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      value: startVT,
      writable: true,
      configurable: true,
    });
    mockMatchMedia(true);

    navigateWithAppPageTransition(router, '/app', 'forward');

    expect(startVT).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/app');
  });

  it('ignores second call while transition is in progress', () => {
    const router = createMockRouter();
    const neverFinish = new Promise<void>(() => {
      // Intentionally never resolves — overlap guard test
    });
    const startVT = vi.fn((callback: () => void) => {
      callback();
      return { finished: neverFinish };
    });
    Object.defineProperty(document, 'startViewTransition', {
      value: startVT,
      writable: true,
      configurable: true,
    });

    navigateWithAppPageTransition(router, '/app/chatroom?id=abc', 'forward');
    navigateWithAppPageTransition(router, '/other', 'forward');

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(startVT).toHaveBeenCalledTimes(1);
  });
});
