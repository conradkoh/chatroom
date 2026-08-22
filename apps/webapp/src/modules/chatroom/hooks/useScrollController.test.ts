import { describe, expect, test, vi } from 'vitest';

import { ScrollController } from './useScrollController';

function feed(clientHeight: number, scrollHeight: number, scrollTop: number) {
  const el = document.createElement('div');
  Object.defineProperties(el, {
    clientHeight: { configurable: true, writable: true, value: clientHeight },
    scrollHeight: { configurable: true, writable: true, value: scrollHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
  Object.defineProperty(el, 'scrollTo', {
    configurable: true,
    value: ({ top }: { top: number }) =>
      Object.defineProperty(el, 'scrollTop', { configurable: true, value: top }),
  });
  return el;
}

describe('ScrollController composer resize pinning', () => {
  test('stays pinned and snaps to the new bottom when client height shrinks', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const el = feed(400, 1200, 800);
    const controller = new ScrollController(() => {});
    controller.attach(el);
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 });
    el.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);
    expect(el.scrollTop).toBe(900);
    frame.mockRestore();
  });

  test('unchanged dimensions still unpin when away from bottom', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const el = feed(400, 1200, 100);
    const controller = new ScrollController(() => {});
    controller.attach(el);
    el.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(false);
  });

  test('re-pins when a user reaches the bottom', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const el = feed(400, 1200, 800);
    const controller = new ScrollController(() => {});
    controller.attach(el);
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: 100 });
    el.dispatchEvent(new Event('scroll'));
    Object.defineProperty(el, 'scrollTop', { configurable: true, value: 800 });
    el.dispatchEvent(new Event('scroll'));
    expect(controller.isPinned).toBe(true);
  });
});
