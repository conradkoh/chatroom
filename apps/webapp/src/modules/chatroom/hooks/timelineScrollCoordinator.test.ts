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

  it('shouldFollowTail when pinned or at bottom', () => {
    Object.defineProperty(el, 'scrollTop', { value: maxScrollTop(), writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.shouldFollowTail()).toBe(true);

    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    expect(coordinator.shouldFollowTail()).toBe(false);
  });

  it('jumpToEnd pins and scrolls via virtualizer', () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    el.dispatchEvent(new Event('scroll'));

    coordinator.jumpToEnd('smooth');
    expect(coordinator.isPinned).toBe(true);
    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('followTail snaps DOM and scrolls virtualizer', () => {
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    coordinator.followTail('auto');
    expect(scrollToEnd).toHaveBeenCalled();
    expect(el.scrollTop).toBe(maxScrollTop());
  });

  it('follows tail on append when pinned', () => {
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

    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('follows tail when the last event changes but count is unchanged (send + purge)', () => {
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

    expect(scrollToEnd).toHaveBeenCalled();
  });

  it('re-snaps tail after purge shrinks the list while pinned', () => {
    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 80,
      tailKey: 'evt-79',
      isLoadingOlder: false,
    });
    scrollToEnd.mockClear();
    Object.defineProperty(el, 'scrollTop', { value: 500, writable: true, configurable: true });

    coordinator.commitTimelineLayout({
      scrollEl: el,
      eventCount: 45,
      tailKey: 'evt-79',
      isLoadingOlder: false,
    });

    expect(scrollToEnd).toHaveBeenCalled();
    expect(el.scrollTop).toBe(maxScrollTop());
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
});
