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
  private programmaticScroll = false;
  private programmaticScrollFrames = 0;

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
    this.markProgrammaticScroll();
    this.virtualizer?.scrollToEnd({ behavior: 'smooth' });
  };

  private markProgrammaticScroll = (): void => {
    this.programmaticScroll = true;
    this.programmaticScrollFrames = 0;
    const tick = () => {
      this.programmaticScrollFrames++;
      if (this.programmaticScrollFrames >= 30) {
        this.programmaticScroll = false;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
    } else if (this.pinned && (countIncreased || tailRotated)) {
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
    if (this.programmaticScroll) return;
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
