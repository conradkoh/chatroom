/**
 * Imperative coordinator for the virtualized chatroom timeline scroll surface.
 *
 * Owns pin/at-bottom state, DOM listeners, and TanStack Virtual scroll commands so
 * React only renders rows and subscribes to pin for UI (jump chip, followOnAppend).
 */

import { TIMELINE_SCROLL_END_THRESHOLD } from '../components/timeline/timelineVirtualizerConfig';

const AT_BOTTOM_THRESHOLD = TIMELINE_SCROLL_END_THRESHOLD;
const USER_SCROLL_TIMEOUT_MS = 200;
export type VirtualizerScrollApi = {
  scrollToEnd: (options?: { behavior?: 'auto' | 'smooth' }) => void;
  scrollToIndex?: (
    index: number,
    options?: { align?: 'end' | 'auto'; behavior?: 'auto' | 'smooth' }
  ) => void;
  scrollToOffset?: (offset: number, options?: { behavior?: 'auto' | 'smooth' }) => void;
  /** Resolve a stable item key to its index after a prepend. */
  findIndexForKey?: (key: string) => number | null;
  getItemStart?: (index: number) => number | null;
  /** When 0, the virtual range is empty (blank viewport) until scroll is reconciled. */
  getVisibleCount?: () => number;
};

export type LoadOlderIntent = 'preserve_position' | 'fill_viewport';

/** Pixel-precise scroll snapshot taken when the user triggers load-older. */
export type PrependScrollAnchor = {
  key: string;
  index: number;
  scrollTop: number;
  scrollHeight: number;
  /** Pixels below the anchored row's start (preserves position within a tall row). */
  offsetInItem: number;
};

type PinListener = () => void;

export class TimelineScrollCoordinator {
  private pinned = true;
  private readonly pinListeners = new Set<PinListener>();

  private el: HTMLElement | null = null;
  private virtualizer: VirtualizerScrollApi | null = null;

  private userScrolling = false;
  private userScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private resizing = false;
  private programmaticScroll = false;

  private pendingSnap = false;
  private rafId: number | null = null;
  private tailSettleRafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private prevEventCount = 0;
  private prevTailKey: string | null = null;
  private prevScrollHeight = 0;
  private wasLoadingOlder = false;
  private hasInitialScroll = false;
  private allowLoadOlder = false;
  private loadOlderIntent: LoadOlderIntent = 'preserve_position';
  /** Set when preserve_position load starts; cleared after prepend is handled. */
  private pendingPrependPreserve = false;
  private prependAnchor: PrependScrollAnchor | null = null;
  private prependSettleRafId: number | null = null;

  constructor(initialPinned = true) {
    this.pinned = initialPinned;
  }

  // ─── React subscription (pin UI) ─────────────────────────────────────────

  subscribe = (listener: PinListener): (() => void) => {
    this.pinListeners.add(listener);
    return () => {
      this.pinListeners.delete(listener);
    };
  };

  getSnapshot = (): boolean => this.pinned;

  get isPinned(): boolean {
    return this.pinned;
  }

  isAtBottom(): boolean {
    return this.computeIsAtBottom();
  }

  /** Whether tail follow should run on append (pinned or physically at bottom). */
  shouldFollowTail(): boolean {
    if (this.pendingPrependPreserve || this.wasLoadingOlder) {
      return false;
    }
    return this.pinned || this.computeIsAtBottom();
  }

  getAllowLoadOlder(): boolean {
    return this.allowLoadOlder;
  }

  /** True while a programmatic scroll (initial follow, tail snap) is in progress. */
  isProgrammaticScrollActive(): boolean {
    return this.programmaticScroll;
  }

  /**
   * When true, TanStack may adjust scrollTop as prepended rows measure in.
   * Disabled during normal scroll-up to avoid first-unpin jumps.
   */
  isPrependScrollPreservationActive(): boolean {
    return this.pendingPrependPreserve || this.prependSettleRafId !== null;
  }

  setLoadOlderIntent(intent: LoadOlderIntent, anchor?: PrependScrollAnchor): void {
    this.loadOlderIntent = intent;
    if (intent === 'preserve_position') {
      this.pendingPrependPreserve = true;
      if (anchor) {
        this.prependAnchor = anchor;
      }
      this.setPinned(false);
    }
  }

  /** Keeps wasLoadingOlder in sync even when layout commit is deferred (e.g. chrome measure). */
  syncIsLoadingOlder(isLoadingOlder: boolean): void {
    this.wasLoadingOlder = isLoadingOlder;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  attach(el: HTMLElement): void {
    if (this.el) {
      this.detach();
    }

    this.el = el;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.pinned && !this.resizing && this.computeIsAtBottom()) {
        this.enqueueSnap();
      }
    });
    this.resizeObserver.observe(el);

    el.addEventListener('wheel', this.handleUserScroll, { passive: true });
    el.addEventListener('touchmove', this.handleUserScroll, { passive: true });
    el.addEventListener('scroll', this.handleScrollEvent, { passive: true });
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.el) {
      this.el.removeEventListener('wheel', this.handleUserScroll);
      this.el.removeEventListener('touchmove', this.handleUserScroll);
      this.el.removeEventListener('scroll', this.handleScrollEvent);
    }

    if (this.userScrollTimeout !== null) {
      clearTimeout(this.userScrollTimeout);
      this.userScrollTimeout = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.tailSettleRafId !== null) {
      cancelAnimationFrame(this.tailSettleRafId);
      this.tailSettleRafId = null;
    }

    if (this.prependSettleRafId !== null) {
      cancelAnimationFrame(this.prependSettleRafId);
      this.prependSettleRafId = null;
    }

    this.pendingSnap = false;
    this.el = null;
    this.virtualizer = null;
  }

  setVirtualizer(api: VirtualizerScrollApi | null): void {
    this.virtualizer = api;
  }

  beginResize(): void {
    this.resizing = true;
  }

  endResize(): void {
    this.resizing = false;
    if (this.pinned) {
      this.followTail('auto');
    }
  }

  // ─── User actions ────────────────────────────────────────────────────────

  /** Jump chip — virtualizer owns scrollTop to avoid DOM/virtual desync. */
  jumpToEnd(behavior: 'auto' | 'smooth' = 'smooth'): void {
    this.setPinned(true);
    this.runProgrammaticScroll(() => {
      this.scrollVirtualizer(behavior);
    });
    requestAnimationFrame(() => {
      this.runProgrammaticScroll(() => {
        this.scrollVirtualizer('auto');
      });
    });
  }

  /**
   * Pinned tail follow — DOM snap + virtualizer (stable as rows measure in).
   */
  followTail(behavior: 'auto' | 'smooth' = 'auto'): void {
    this.setPinned(true);
    this.runProgrammaticScroll(() => {
      this.snapDomImmediate();
      this.scrollVirtualizer(behavior);
      this.syncVirtualizerScrollFromDom();
    });
    requestAnimationFrame(() => {
      this.scrollVirtualizer(behavior);
      this.snapDomImmediate();
      this.syncVirtualizerScrollFromDom();
    });
  }

  /**
   * Called from useLayoutEffect when timeline data or loading flags change.
   * Prepend scroll preservation uses DOM height delta + virtualizer offset sync
   * (`anchorTo: 'end'` alone is not enough when rows measure in or chrome shifts).
   */
  commitTimelineLayout(input: {
    scrollEl: HTMLElement | null;
    eventCount: number;
    tailKey: string | null;
    isLoadingOlder: boolean;
  }): void {
    const { scrollEl, eventCount, tailKey, isLoadingOlder } = input;

    const countIncreased = eventCount > this.prevEventCount;
    const tailChanged =
      tailKey !== null && tailKey !== this.prevTailKey && this.prevTailKey !== null;
    const isPrependWhileLoadingOlder =
      countIncreased &&
      (this.wasLoadingOlder || isLoadingOlder || this.pendingPrependPreserve);

    if (eventCount > 0 && !this.hasInitialScroll) {
      this.hasInitialScroll = true;
      this.allowLoadOlder = false;
      if (this.pinned) {
        this.scheduleTailSettle({ onSettled: () => {
          this.allowLoadOlder = true;
        } });
      } else {
        this.allowLoadOlder = true;
      }
    } else if (scrollEl && (countIncreased || tailChanged)) {
      if (isPrependWhileLoadingOlder) {
        if (this.loadOlderIntent === 'fill_viewport') {
          this.followTail('auto');
          this.loadOlderIntent = 'preserve_position';
          this.pendingPrependPreserve = false;
          this.prependAnchor = null;
        } else {
          this.applyPrependScrollPreserve(scrollEl);
        }
      } else if (this.shouldFollowTail()) {
        // Tail key covers subscription slide-off (same count); count covers growth without tail rotation.
        this.followTail('auto');
      }

      this.prevScrollHeight = scrollEl.scrollHeight;
    } else if (scrollEl) {
      this.prevScrollHeight = scrollEl.scrollHeight;
    }

    this.prevEventCount = eventCount;
    this.prevTailKey = tailKey;
    this.wasLoadingOlder = isLoadingOlder;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private setPinned(pinned: boolean): void {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    for (const listener of this.pinListeners) {
      listener();
    }
  }

  private scrollVirtualizer(behavior: 'auto' | 'smooth'): void {
    this.virtualizer?.scrollToEnd({ behavior });
  }

  private enqueueSnap(): void {
    this.pendingSnap = true;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.processSnapQueue();
      });
    }
  }

  private processSnapQueue(): void {
    if (this.pendingSnap && this.pinned && this.el) {
      this.snapDomImmediate();
      this.scrollVirtualizer('auto');
    }
    this.pendingSnap = false;
    this.rafId = null;
  }

  private snapDomImmediate(): void {
    if (this.el) {
      this.el.scrollTop = this.getMaxScrollTop();
    }
  }

  /**
   * Restore the exact viewport using scrollTop + scrollHeight delta, then re-settle
   * over a few frames as rows measure in (avoids scrollToIndex row-snapping jank).
   */
  private applyPrependScrollPreserve(scrollEl: HTMLElement): void {
    if (!this.el) return;

    const anchor = this.prependAnchor;
    const heightDiff = anchor
      ? scrollEl.scrollHeight - anchor.scrollHeight
      : scrollEl.scrollHeight - this.prevScrollHeight;

    if (heightDiff <= 0) {
      this.pendingPrependPreserve = false;
      return;
    }

    // Use live scrollTop so top-chrome growth (load-older spinner) between capture
    // and prepend is not overwritten by the stale anchor snapshot.
    const targetTop = this.el.scrollTop + heightDiff;
    this.runProgrammaticScroll(() => {
      this.applyPrependScrollTop(targetTop);
    });

    if (anchor) {
      this.schedulePrependScrollSettle(scrollEl, {
        ...anchor,
        scrollTop: targetTop,
        scrollHeight: scrollEl.scrollHeight,
      });
    } else {
      this.pendingPrependPreserve = false;
    }

    this.prependAnchor = null;
  }

  private applyPrependScrollTop(targetTop: number): void {
    if (!this.el) return;

    this.el.scrollTop = targetTop;
    this.virtualizer?.scrollToOffset?.(targetTop, { behavior: 'auto' });
    this.syncVirtualizerScrollFromDom();
  }

  /** Fine-tune using the stable row key once measurements have caught up. */
  private applyPrependAnchorByKey(anchor: PrependScrollAnchor): boolean {
    if (!this.el || !this.virtualizer?.findIndexForKey || !this.virtualizer.getItemStart) {
      return false;
    }

    const index = this.virtualizer.findIndexForKey(anchor.key);
    if (index === null) return false;

    const itemStart = this.virtualizer.getItemStart(index);
    if (itemStart === null) return false;

    const targetTop = itemStart + anchor.offsetInItem;
    if (Math.abs(this.el.scrollTop - targetTop) < 0.5) return true;

    this.el.scrollTop = targetTop;
    this.virtualizer?.scrollToOffset?.(targetTop, { behavior: 'auto' });
    this.syncVirtualizerScrollFromDom();
    return true;
  }

  private schedulePrependScrollSettle(
    scrollEl: HTMLElement,
    anchor: PrependScrollAnchor
  ): void {
    if (this.prependSettleRafId !== null) {
      cancelAnimationFrame(this.prependSettleRafId);
    }

    let frames = 0;
    const maxFrames = 8;

    const tick = (): void => {
      frames++;
      if (!this.el) {
        this.prependSettleRafId = null;
        return;
      }

      const heightDiff = scrollEl.scrollHeight - anchor.scrollHeight;
      if (heightDiff > 0) {
        const targetTop = anchor.scrollTop + heightDiff;
        if (Math.abs(this.el.scrollTop - targetTop) > 0.5) {
          this.runProgrammaticScroll(() => {
            this.applyPrependScrollTop(targetTop);
          });
        }
      }

      this.applyPrependAnchorByKey(anchor);

      if (frames >= maxFrames) {
        this.prependSettleRafId = null;
        this.pendingPrependPreserve = false;
        return;
      }

      this.prependSettleRafId = requestAnimationFrame(tick);
    };

    this.prependSettleRafId = requestAnimationFrame(tick);
  }

  private getMaxScrollTop(): number {
    if (!this.el) return 0;
    return Math.max(0, this.el.scrollHeight - this.el.clientHeight);
  }

  private runProgrammaticScroll(action: () => void): void {
    this.programmaticScroll = true;
    action();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.programmaticScroll = false;
      });
    });
  }

  /**
   * Multi-frame tail recovery — virtualizer range and DOM scrollHeight often lag one
   * or more frames after count changes.
   */
  private scheduleTailSettle(options: {
    tailIndex?: number;
    maxFrames?: number;
    onSettled?: () => void;
  } = {}): void {
    const maxFrames = options.maxFrames ?? 24;
    const tailIndex = options.tailIndex;

    if (this.tailSettleRafId !== null) {
      cancelAnimationFrame(this.tailSettleRafId);
    }

    let frames = 0;

    const tick = (): void => {
      frames++;
      const visibleCount = this.virtualizer?.getVisibleCount?.() ?? 1;
      const rangeEmpty = visibleCount === 0;
      const atBottom = this.computeIsAtBottom();

      if (this.pinned && this.el && (!atBottom || rangeEmpty)) {
        this.runProgrammaticScroll(() => {
          this.reconcileTailScroll(tailIndex);
        });
      }

      const settled = atBottom && !rangeEmpty && frames >= 2;

      if (settled || frames >= maxFrames) {
        this.tailSettleRafId = null;
        options.onSettled?.();
        return;
      }

      this.tailSettleRafId = requestAnimationFrame(tick);
    };

    this.runProgrammaticScroll(() => {
      this.reconcileTailScroll(tailIndex);
    });

    this.tailSettleRafId = requestAnimationFrame(tick);
  }

  /** Align DOM, virtualizer scrollOffset (via scrollToOffset), and visible range. */
  private reconcileTailScroll(tailIndex: number | undefined): void {
    if (tailIndex !== undefined && tailIndex >= 0) {
      this.virtualizer?.scrollToIndex?.(tailIndex, { align: 'end', behavior: 'auto' });
    }
    this.scrollVirtualizer('auto');
    this.snapDomImmediate();
    this.syncVirtualizerScrollFromDom();
  }

  /**
   * TanStack Virtual caches scrollOffset from scroll events; DOM-only writes leave the
   * range empty until the user scrolls. scrollToOffset + a synthetic scroll event sync it.
   */
  private syncVirtualizerScrollFromDom(): void {
    if (!this.el) return;

    const maxTop = this.getMaxScrollTop();
    const top = Math.min(this.el.scrollTop, maxTop);
    if (this.el.scrollTop !== top) {
      this.el.scrollTop = top;
    }

    this.virtualizer?.scrollToOffset?.(top, { behavior: 'auto' });
    this.el.dispatchEvent(new Event('scroll'));
  }

  private computeIsAtBottom(): boolean {
    if (!this.el) return false;
    const { scrollTop, scrollHeight, clientHeight } = this.el;
    if (scrollHeight <= clientHeight) return false;
    return scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;
  }

  private handleUserScroll = (): void => {
    this.userScrolling = true;

    if (this.userScrollTimeout !== null) {
      clearTimeout(this.userScrollTimeout);
    }

    this.userScrollTimeout = setTimeout(() => {
      this.userScrolling = false;
      this.userScrollTimeout = null;

      const atBottom = this.computeIsAtBottom();
      if (!atBottom && this.pinned) {
        this.setPinned(false);
      } else if (atBottom && !this.pinned) {
        this.setPinned(true);
      }
    }, USER_SCROLL_TIMEOUT_MS);
  };

  private handleScrollEvent = (): void => {
    if (this.programmaticScroll) return;

    const atBottom = this.computeIsAtBottom();

    if (atBottom && !this.pinned) {
      this.setPinned(true);
      return;
    }

    if (this.userScrolling) return;

    if (!atBottom && this.pinned) {
      this.setPinned(false);
    }
  };
}
