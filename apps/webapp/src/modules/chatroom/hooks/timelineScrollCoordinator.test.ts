/**
 * TimelineScrollCoordinator — pin + scroll policy unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TimelineScrollCoordinator } from './timelineScrollCoordinator';

describe('TimelineScrollCoordinator', () => {
  let coordinator: TimelineScrollCoordinator;
  let el: HTMLDivElement;
  const scrollToEnd = vi.fn();

  const maxScrollTop = () => el.scrollHeight - el.clientHeight;

  /** Virtualizer scrollToOffset is deferred via queueMicrotask (avoids flushSync-in-layout). */
  const flushVirtualizerSync = () => Promise.resolve();

  beforeEach(() => {
    coordinator = new TimelineScrollCoordinator();
    el = document.createElement('div');
    Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });
    coordinator.attach(el);
    coordinator.setVirtualizer({ scrollToEnd });
    scrollToEnd.mockClear();
  });

  afterEach(() => {
    coordinator.detach();
  });

  it('re-pins immediately when scroll reaches bottom during wheel scroll', () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.isPinned).toBe(false);

    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });
    el.dispatchEvent(new Event('wheel'));
    el.dispatchEvent(new Event('scroll'));

    expect(coordinator.isPinned).toBe(true);
  });

  it('shouldFollowTail only when pinned and flush at the tail', () => {
    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.shouldFollowTail()).toBe(true);

    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.shouldFollowTail()).toBe(false);

    const unpinned = new TimelineScrollCoordinator(false);
    unpinned.attach(el);
    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });
    expect(unpinned.shouldFollowTail()).toBe(false);
    unpinned.detach();
  });

  it('shouldFollowTail is false when pinned but only partially at the tail', () => {
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 80,
      writable: true,
      configurable: true,
    });
    expect(coordinator.shouldFollowTail()).toBe(false);
  });

  it('jumpToEnd pins, snaps DOM to tail, and scrolls via virtualizer', async () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));

    coordinator.jumpToEnd();
    expect(coordinator.isPinned).toBe(true);
    expect(el.scrollTop).toBe(maxScrollTop());
    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('stays unpinned when only partially scrolled from the tail', () => {
    const partialFromBottom = 40;
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - partialFromBottom,
      writable: true,
      configurable: true,
    });
    el.dispatchEvent(new Event('scroll'));

    expect(coordinator.isPinned).toBe(false);
    expect(coordinator.isAtBottom()).toBe(false);
  });

  it('jumpToEnd reaches tail from a partial scroll position', async () => {
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 80,
      writable: true,
      configurable: true,
    });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.isPinned).toBe(false);

    scrollToEnd.mockClear();
    coordinator.jumpToEnd();

    expect(coordinator.isPinned).toBe(true);
    expect(el.scrollTop).toBe(maxScrollTop());
    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('jumpToEnd pins immediately and uses auto scroll from unpinned partial position', async () => {
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 120,
      writable: true,
      configurable: true,
    });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.isPinned).toBe(false);

    scrollToEnd.mockClear();
    coordinator.jumpToEnd();

    expect(coordinator.isPinned).toBe(true);
    expect(el.scrollTop).toBe(maxScrollTop());
    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: 'auto' });
  });

  it('jumpToEnd stays pinned when scroll events fire mid-flight during programmatic scroll', () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.isPinned).toBe(false);

    coordinator.jumpToEnd();
    expect(coordinator.isPinned).toBe(true);

    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));

    expect(coordinator.isPinned).toBe(true);
  });

  it('followTail snaps DOM and scrolls virtualizer', async () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    coordinator.followTail('auto');
    expect(el.scrollTop).toBe(maxScrollTop());
    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('follows tail on append when pinned but not yet flush at the tail', async () => {
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 80,
      writable: true,
      configurable: true,
    });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 2,
      tailKey: 'evt-1',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 3,
      tailKey: 'evt-2',
      isLoadingOlder: false,
    });

    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
    expect(coordinator.isPinned).toBe(true);
  });

  it('follows tail on append when pinned', async () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 2,
      tailKey: 'evt-1',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 3,
      tailKey: 'evt-2',
      isLoadingOlder: false,
    });

    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('re-snaps during append tail settle when new tail row measures in', async () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 2,
      tailKey: 'evt-1',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 3,
      tailKey: 'evt-2',
      isLoadingOlder: false,
    });

    Object.defineProperty(el, 'scrollHeight', { value: 1500, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true, configurable: true });

    await new Promise<void>((resolve) => {
      const wait = () => {
        if (el.scrollTop === maxScrollTop()) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    expect(el.scrollTop).toBe(1100);
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('follows tail when the last event changes but count is unchanged', async () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 50,
      tailKey: 'evt-49',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 50,
      tailKey: 'evt-50',
      isLoadingOlder: false,
    });

    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('syncs virtualizer scrollOffset from the DOM after tail reconcile', async () => {
    const scrollToOffset = vi.fn();
    coordinator.setVirtualizer({ scrollToEnd, scrollToOffset });
    Object.defineProperty(el, 'scrollTop', { value: 900, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1300, writable: true, configurable: true });

    coordinator.followTail('auto');
    expect(scrollToOffset).not.toHaveBeenCalled();

    await flushVirtualizerSync();
    expect(scrollToOffset).toHaveBeenCalledWith(900, { behavior: 'auto' });
  });

  it('notifyTopChromeDelta adjusts DOM immediately and defers virtualizer sync', async () => {
    const scrollToOffset = vi.fn();
    coordinator.setVirtualizer({ scrollToEnd, scrollToOffset });
    Object.defineProperty(el, 'scrollTop', { value: 200, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 2000, writable: true, configurable: true });

    coordinator.notifyTopChromeDelta(48);
    expect(el.scrollTop).toBe(248);
    expect(scrollToOffset).not.toHaveBeenCalled();

    await flushVirtualizerSync();
    expect(scrollToOffset).toHaveBeenCalledWith(248, { behavior: 'auto' });
  });

  it('preserves scrollTop via captured anchor when wasLoadingOlder was not committed during chrome defer', () => {
    const scrollToOffset = vi.fn();
    coordinator.setVirtualizer({ scrollToEnd, scrollToOffset });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    Object.defineProperty(el, 'scrollTop', { value: 200, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true, configurable: true });

    coordinator.setLoadOlderIntent('preserve_position', {
      key: 'evt-3',
      index: 3,
      scrollTop: 200,
      scrollHeight: 1000,
      offsetInItem: 0,
    });
    scrollToEnd.mockClear();

    Object.defineProperty(el, 'scrollHeight', { value: 3000, writable: true, configurable: true });
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 30,
      tailKey: 'evt-29',
      isLoadingOlder: false,
    });

    expect(el.scrollTop).toBe(2200);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('preserves scrollTop when chrome grew between anchor capture and prepend', () => {
    const scrollToOffset = vi.fn();
    coordinator.setVirtualizer({ scrollToEnd, scrollToOffset });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    Object.defineProperty(el, 'scrollTop', { value: 200, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true, configurable: true });

    coordinator.setLoadOlderIntent('preserve_position', {
      key: 'evt-3',
      index: 3,
      scrollTop: 200,
      scrollHeight: 1000,
      offsetInItem: 0,
    });

    Object.defineProperty(el, 'scrollTop', { value: 224, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 3024, writable: true, configurable: true });
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 30,
      tailKey: 'evt-29',
      isLoadingOlder: false,
    });

    expect(el.scrollTop).toBe(224 + 2024);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('syncs virtualizer offset immediately on prepend preserve', () => {
    const scrollToOffset = vi.fn();
    coordinator.setVirtualizer({ scrollToEnd, scrollToOffset });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    Object.defineProperty(el, 'scrollTop', { value: 120, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true, configurable: true });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: true,
    });

    Object.defineProperty(el, 'scrollHeight', { value: 3000, writable: true, configurable: true });
    coordinator.setLoadOlderIntent('preserve_position');
    scrollToOffset.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 30,
      tailKey: 'evt-29',
      isLoadingOlder: false,
    });

    expect(scrollToOffset).toHaveBeenCalled();
  });

  it('preserves scrollTop when prepending while loading older (preserve_position)', async () => {
    const scrollToOffset = vi.fn();
    coordinator.setVirtualizer({ scrollToEnd, scrollToOffset });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    Object.defineProperty(el, 'scrollTop', { value: 120, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 1000, writable: true, configurable: true });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: true,
    });

    Object.defineProperty(el, 'scrollHeight', { value: 3000, writable: true, configurable: true });
    coordinator.setLoadOlderIntent('preserve_position');
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 30,
      tailKey: 'evt-29',
      isLoadingOlder: false,
    });

    expect(el.scrollTop).toBe(2120);
    expect(scrollToEnd).not.toHaveBeenCalled();
    await flushVirtualizerSync();
    expect(scrollToOffset).toHaveBeenCalled();
  });

  it('does not follow when count grows from prepend while loading older', () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: true,
    });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 30,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('re-snaps during initial tail settle when content height grows', async () => {
    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 2,
      tailKey: 'evt-1',
      isLoadingOlder: false,
    });

    Object.defineProperty(el, 'scrollHeight', { value: 1500, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true, configurable: true });

    await new Promise<void>((resolve) => {
      const wait = () => {
        if (el.scrollTop === maxScrollTop()) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    expect(el.scrollTop).toBe(1100);
  });

  it('defers allowLoadOlder until after initial scroll settles', async () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 2,
      tailKey: 'evt-1',
      isLoadingOlder: false,
    });

    expect(coordinator.getAllowLoadOlder()).toBe(false);

    await new Promise<void>((resolve) => {
      const wait = () => {
        if (coordinator.getAllowLoadOlder()) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    expect(coordinator.getAllowLoadOlder()).toBe(true);
  });

  it('does not follow tail on append when unpinned and not at bottom', () => {
    const unpinned = new TimelineScrollCoordinator(false);
    unpinned.attach(el);
    unpinned.setVirtualizer({ scrollToEnd });
    scrollToEnd.mockClear();

    unpinned.commitTimelineLayout({
      scrollEl: el,
      eventCount: 2,
      tailKey: 'evt-1',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    unpinned.commitTimelineLayout({
      scrollEl: el,
      eventCount: 3,
      tailKey: 'evt-2',
      isLoadingOlder: false,
    });

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('notifyTailRowResized re-snaps when pinned at bottom and tail row grows', async () => {
    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 25,
      tailKey: 'evt-24',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    Object.defineProperty(el, 'scrollHeight', { value: 1500, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true, configurable: true });

    coordinator.notifyTailRowResized(24);

    await new Promise<void>((resolve) => {
      const wait = () => {
        if (el.scrollTop === maxScrollTop()) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    expect(el.scrollTop).toBe(1100);
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('notifyTailRowResized is a no-op when unpinned', () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    scrollToEnd.mockClear();

    coordinator.notifyTailRowResized(24);

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('notifyTailRowResized is a no-op when pinned but not flush at the tail', () => {
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 80,
      writable: true,
      configurable: true,
    });
    scrollToEnd.mockClear();

    coordinator.notifyTailRowResized(24);

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('notifyTailRowResized is a no-op during prepend scroll preservation', () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    coordinator.setLoadOlderIntent('preserve_position');
    scrollToEnd.mockClear();

    coordinator.notifyTailRowResized(9);

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('coalesces multiple tail_settle intents in one flush pass', () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 10,
      tailKey: 'evt-9',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();

    coordinator.notifyTailRowResized(9);
    coordinator.notifyTailRowResized(9);
    coordinator.notifyTailRowResized(9);

    // Without coalescing, each notify could trigger multiple scroll passes.
    expect(scrollToEnd.mock.calls.length).toBeLessThan(6);
  });

  it('pinned tail guard corrects scrollTop below max while pinned', async () => {
    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 120,
      writable: true,
      configurable: true,
    });
    coordinator.followTail('auto');

    await new Promise<void>((resolve) => {
      const wait = () => {
        if (el.scrollTop === maxScrollTop()) {
          resolve();
          return;
        }
        requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
    });

    await flushVirtualizerSync();
    expect(el.scrollTop).toBe(maxScrollTop());
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('endResize enqueues follow and tail settle when pinned', async () => {
    coordinator.beginResize();
    scrollToEnd.mockClear();
    coordinator.endResize();
    await flushVirtualizerSync();
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('does not unpin on scroll while programmatic tail follow is active', () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.isPinned).toBe(false);

    coordinator.followTail('auto');
    expect(coordinator.isPinned).toBe(true);
    expect(coordinator.isProgrammaticScrollActive()).toBe(true);

    Object.defineProperty(el, 'scrollTop', { value: 200, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));

    expect(coordinator.isPinned).toBe(true);
  });

  it('cancels pending tail work when user scrolls away from the tail', () => {
    scrollToEnd.mockClear();

    Object.defineProperty(el, 'scrollTop', {
      value: maxScrollTop() - 80,
      writable: true,
      configurable: true,
    });
    el.dispatchEvent(new Event('scroll'));

    expect(coordinator.isPinned).toBe(false);
    coordinator.notifyTailRowResized(9);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});
