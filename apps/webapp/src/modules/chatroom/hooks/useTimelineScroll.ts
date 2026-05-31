'use client';

/**
 * Timeline scroll policy with a single scroll authority: the virtualizer.
 * No direct DOM scrollTop writes, synthetic scroll events, or settle loops.
 * Pin state derives from native scroll events; React reads it via useSyncExternalStore.
 */
import { useRef } from 'react';

import { TIMELINE_SCROLL_END_THRESHOLD } from '../components/timeline/timelineVirtualizerConfig';

export interface VirtualizerHandle {
  scrollToEnd: (opts?: { behavior?: 'auto' | 'smooth' }) => void;
}

export interface TimelineScrollApi {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  attach: (el: HTMLElement) => () => void;
  setVirtualizer: (api: VirtualizerHandle | null) => void;
  jumpToEnd: () => void;
  commit: (input: {
    eventCount: number;
    tailEventId: string | null;
    isLoadingOlder: boolean;
  }) => void;
  isPendingPrepend: () => boolean;
  isAtBottom: () => boolean;
  beginLoadOlder: () => void;
}

/** @internal Exported for unit tests. */
export class TimelineScrollState implements TimelineScrollApi {
  private pinned = true;
  private readonly listeners = new Set<() => void>();
  private el: HTMLElement | null = null;
  private virtualizer: VirtualizerHandle | null = null;
  private pendingPrepend = false;
  private prevEventCount = 0;
  private prevTailEventId: string | null = null;
  private wasLoadingOlder = false;
  private loadOlderMarker = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.pinned;

  attach = (el: HTMLElement): (() => void) => {
    this.el = el;
    el.addEventListener('scroll', this.onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', this.onScroll);
      if (this.el === el) this.el = null;
    };
  };

  setVirtualizer = (api: VirtualizerHandle | null): void => {
    this.virtualizer = api;
  };

  jumpToEnd = (): void => {
    this.setPinned(true);
    this.virtualizer?.scrollToEnd({ behavior: 'smooth' });
  };

  beginLoadOlder = (): void => {
    this.loadOlderMarker = true;
  };

  isPendingPrepend = (): boolean => this.pendingPrepend;

  isAtBottom = (): boolean => {
    const el = this.el;
    if (!el) return this.pinned;
    return el.scrollHeight - el.scrollTop - el.clientHeight < TIMELINE_SCROLL_END_THRESHOLD;
  };

  commit = (input: {
    eventCount: number;
    tailEventId: string | null;
    isLoadingOlder: boolean;
  }): void => {
    const { eventCount, tailEventId, isLoadingOlder } = input;
    const countIncreased = eventCount > this.prevEventCount;
    const tailRotated =
      tailEventId !== null &&
      this.prevTailEventId !== null &&
      tailEventId !== this.prevTailEventId;
    const loadingDone = this.wasLoadingOlder && !isLoadingOlder;

    if (isLoadingOlder || loadingDone || this.loadOlderMarker) {
      this.pendingPrepend = true;
      queueMicrotask(() => {
        this.pendingPrepend = false;
      });
      this.loadOlderMarker = false;
    } else if ((countIncreased || tailRotated) && this.isAtBottom()) {
      // Defensive: re-check at-bottom against the DOM right now, not against the
      // possibly-stale `this.pinned` flag. Append should only scroll-to-end if
      // the user is currently sitting at the bottom.
      this.virtualizer?.scrollToEnd({ behavior: 'auto' });
    }

    this.prevEventCount = eventCount;
    this.prevTailEventId = tailEventId;
    this.wasLoadingOlder = isLoadingOlder;
  };

  private setPinned(value: boolean): void {
    if (this.pinned === value) return;
    this.pinned = value;
    for (const listener of this.listeners) listener();
  }

  private onScroll = (): void => {
    if (this.isAtBottom()) {
      this.setPinned(true);
    } else if (this.pinned) {
      this.setPinned(false);
    }
  };
}

export function useTimelineScroll(): TimelineScrollApi {
  const stateRef = useRef<TimelineScrollState | null>(null);
  stateRef.current ??= new TimelineScrollState();
  return stateRef.current;
}
