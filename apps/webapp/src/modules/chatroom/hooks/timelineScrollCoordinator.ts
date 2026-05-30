/**
 * Imperative coordinator for the virtualized chatroom timeline scroll surface.
 *
 * Owns pin/at-bottom state, DOM listeners, and TanStack Virtual scroll commands so
 * React only renders rows and subscribes to pin for UI (jump chip, purge, followOnAppend).
 */

import { TIMELINE_SCROLL_END_THRESHOLD } from '../components/timeline/timelineVirtualizerConfig';

const AT_BOTTOM_THRESHOLD = TIMELINE_SCROLL_END_THRESHOLD;
const USER_SCROLL_TIMEOUT_MS = 200;
export type VirtualizerScrollApi = {
  scrollToEnd: (options?: { behavior?: 'auto' | 'smooth' }) => void;
};

export type LoadOlderIntent = 'preserve_position' | 'fill_viewport';

export type TimelineCommitResult = {
  prevEventCount: number;
  prevScrollHeight: number;
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
  private resizeObserver: ResizeObserver | null = null;

  private prevEventCount = 0;
  private prevTailKey: string | null = null;
  private prevScrollHeight = 0;
  private wasLoadingOlder = false;
  private hasInitialScroll = false;
  private allowLoadOlder = false;
  private loadOlderIntent: LoadOlderIntent = 'preserve_position';

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

  /** Virtualizer `followOnAppend` — only when pinned. */
  shouldFollowOnAppend(): boolean {
    return this.pinned;
  }

  /** Whether tail follow should run on append (pinned or physically at bottom). */
  shouldFollowTail(): boolean {
    return this.pinned || this.computeIsAtBottom();
  }

  getAllowLoadOlder(): boolean {
    return this.allowLoadOlder;
  }

  /** True while a programmatic scroll (initial follow, tail snap) is in progress. */
  isProgrammaticScrollActive(): boolean {
    return this.programmaticScroll;
  }

  setLoadOlderIntent(intent: LoadOlderIntent): void {
    this.loadOlderIntent = intent;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  attach(el: HTMLElement): void {
    if (this.el) {
      this.detach();
    }

    this.el = el;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.pinned && !this.resizing) {
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
    this.scrollVirtualizer(behavior);
    requestAnimationFrame(() => {
      this.scrollVirtualizer('auto');
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
    });
    requestAnimationFrame(() => {
      this.scrollVirtualizer(behavior);
      this.snapDomImmediate();
    });
  }

  getScrollPosition(): { scrollTop: number } | null {
    if (!this.el) return null;
    return { scrollTop: this.el.scrollTop };
  }

  /**
   * Called from useLayoutEffect when timeline data or loading flags change.
   * Prepend scroll preservation is handled by the virtualizer (`anchorTo: 'end'`).
   */
  commitTimelineLayout(input: {
    scrollEl: HTMLElement | null;
    eventCount: number;
    tailKey: string | null;
    isLoadingOlder: boolean;
  }): TimelineCommitResult {
    const { scrollEl, eventCount, tailKey, isLoadingOlder } = input;
    const prev = {
      prevEventCount: this.prevEventCount,
      prevScrollHeight: this.prevScrollHeight,
    };

    const countIncreased = eventCount > this.prevEventCount;
    const tailChanged =
      tailKey !== null && tailKey !== this.prevTailKey && this.prevTailKey !== null;
    const isPrependWhileLoadingOlder = countIncreased && this.wasLoadingOlder;

    if (eventCount > 0 && !this.hasInitialScroll) {
      this.hasInitialScroll = true;
      this.allowLoadOlder = false;
      if (this.pinned) {
        this.followTail('auto');
        this.scheduleInitialTailSettle();
      } else {
        this.allowLoadOlder = true;
      }
    } else if (scrollEl && (countIncreased || tailChanged)) {
      if (isPrependWhileLoadingOlder) {
        if (this.loadOlderIntent === 'fill_viewport') {
          this.followTail('auto');
          this.loadOlderIntent = 'preserve_position';
        }
        // `preserve_position` — virtualizer end-anchor preserves scroll; no DOM delta.
      } else if (this.shouldFollowTail()) {
        // Tail key covers send+purge (same count); count covers growth without tail rotation.
        this.followTail('auto');
      }

      this.prevScrollHeight = scrollEl.scrollHeight;
    } else if (scrollEl) {
      this.prevScrollHeight = scrollEl.scrollHeight;
    }

    this.prevEventCount = eventCount;
    this.prevTailKey = tailKey;
    this.wasLoadingOlder = isLoadingOlder;

    return prev;
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
   * Keep snapping to the tail until the viewport is at the bottom or we time out.
   * Covers top-chrome scrollMargin settling, row measurement growth, and paddingEnd.
   */
  private scheduleInitialTailSettle(): void {
    let frames = 0;
    const maxFrames = 24;

    const tick = (): void => {
      frames++;

      if (this.pinned && this.el && !this.computeIsAtBottom()) {
        this.runProgrammaticScroll(() => {
          this.snapDomImmediate();
          this.scrollVirtualizer('auto');
        });
      }

      const atBottom = this.computeIsAtBottom();
      const settled = atBottom && frames >= 2;

      if (settled || frames >= maxFrames) {
        this.allowLoadOlder = true;
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
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
