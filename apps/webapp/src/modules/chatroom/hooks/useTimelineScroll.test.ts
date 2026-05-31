import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TimelineScrollState, type VirtualizerHandle } from './useTimelineScroll';

function mockScrollEl({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  return el;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('TimelineScrollState', () => {
  let state: TimelineScrollState;
  let scrollToEnd: ReturnType<typeof vi.fn<VirtualizerHandle['scrollToEnd']>>;

  beforeEach(() => {
    state = new TimelineScrollState();
    scrollToEnd = vi.fn<VirtualizerHandle['scrollToEnd']>();
    state.setVirtualizer({ scrollToEnd });
  });

  it('subscribe/getSnapshot fires only on pin change', () => {
    const listener = vi.fn();
    state.subscribe(listener);
    expect(state.getSnapshot()).toBe(true);

    const el = mockScrollEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 });
    state.attach(el);
    el.dispatchEvent(new Event('scroll'));
    expect(state.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    Object.defineProperty(el, 'scrollTop', { value: 950, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(state.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    el.dispatchEvent(new Event('scroll'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('commit with pinned + countIncreased calls scrollToEnd', () => {
    state.commit({ eventCount: 5, tailEventId: 'a', isLoadingOlder: false });
    scrollToEnd.mockClear();

    state.commit({ eventCount: 6, tailEventId: 'b', isLoadingOlder: false });
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('commit with isLoadingOlder sets pendingPrepend then clears after microtask', async () => {
    state.commit({ eventCount: 10, tailEventId: 'x', isLoadingOlder: true });
    expect(state.isPendingPrepend()).toBe(true);
    await flushMicrotasks();
    expect(state.isPendingPrepend()).toBe(false);
  });

  it('commit with tail rotation and same count follows when pinned', () => {
    state.commit({ eventCount: 5, tailEventId: 'a', isLoadingOlder: false });
    scrollToEnd.mockClear();

    state.commit({ eventCount: 5, tailEventId: 'b', isLoadingOlder: false });
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('jumpToEnd calls scrollToEnd smooth and sets pinned', () => {
    const el = mockScrollEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 });
    state.attach(el);
    el.dispatchEvent(new Event('scroll'));
    expect(state.getSnapshot()).toBe(false);

    state.jumpToEnd();
    expect(state.getSnapshot()).toBe(true);
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('scroll listener updates pinned from at-bottom math', () => {
    const el = mockScrollEl({ scrollTop: 0, scrollHeight: 500, clientHeight: 100 });
    state.attach(el);

    expect(state.isAtBottom()).toBe(false);
    el.dispatchEvent(new Event('scroll'));
    expect(state.getSnapshot()).toBe(false);

    Object.defineProperty(el, 'scrollTop', { value: 460, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(state.isAtBottom()).toBe(true);
    expect(state.getSnapshot()).toBe(true);
  });
});
