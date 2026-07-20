/**
 * Imperative coordinator for the virtualized chatroom timeline scroll surface.
 *
 * Owns pin/at-bottom state, DOM listeners, and TanStack Virtual scroll commands so
 * React only renders rows and subscribes to pin for UI (jump chip, followOnAppend).
 *
 * Design doc (what works, pitfalls, abandoned approaches): ./timelineScrollCoordinator.md
 *
 * TIMELINE_TAIL_SCROLL_FIX_ATTEMPTS
 * Recorded: 2026-06-02T06:45:00Z (planner investigation)
 *
 * P0 (this PR): When pinned, scheduleTailSettle when tail row measured height increases
 *   (virtualizer measurement cache / measureElement — in-place message growth, footer #603)
 * P1: Extend commitTimelineLayout with tail content revision signal (taskStatus, content length)
 * P2: Enable shouldAdjustScrollPositionOnItemSizeChange for tail index while pinned (not only prepend)
 */

import { TIMELINE_PIN_AT_BOTTOM_THRESHOLD } from '../components/timeline/timelineVirtualizerConfig';

const AT_BOTTOM_THRESHOLD = TIMELINE_PIN_AT_BOTTOM_THRESHOLD;
const USER_SCROLL_TIMEOUT_MS = 200;
/** Cap pinned-tail guard rAF iterations so a stuck layout cannot spin forever. */
const PINNED_TAIL_GUARD_MAX_ITERATIONS = 30;
/** Max rAF frames for tail settle after follow/jump/measure-in. */
const TAIL_SETTLE_MAX_FRAMES = 24;
/** Max rAF frames for prepend height-delta preservation after load-older. */
const PREPEND_SETTLE_MAX_FRAMES = 8;
/** Max rAF frames for `runProgrammaticScroll` target-check loop before clearing the flag. */
const PROGRAMMATIC_SCROLL_CLEAR_MAX_FRAMES = 30;

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

type ScrollIntent =
  | { type: 'follow_tail'; behavior: 'auto' | 'smooth' }
  | {
      type: 'tail_settle';
      tailIndex?: number;
      onSettled?: () => void;
      maxFrames?: number;
    }
  | { type: 'snap' }
  | { type: 'preserve_prepend'; scrollEl: HTMLElement }
  | { type: 'adjust_top_chrome'; deltaPx: number }
  | { type: 'cancel_programmatic' };

type TailSettleState = {
  frames: number;
  maxFrames: number;
  tailIndex?: number;
  onSettled?: () => void;
};

type ScrollSnapshot = {
  scrollTop: number;
  pinned: boolean;
};

export class TimelineScrollCoordinator {
  private pinned = true;
  private readonly pinListeners = new Set<PinListener>();

  private el: HTMLElement | null = null;
  private virtualizer: VirtualizerScrollApi | null = null;

  private userScrolling = false;
  private userScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private resizing = false;
  private programmaticScroll = false;
  private programmaticScrollDepth = 0;

  private readonly intentQueue: ScrollIntent[] = [];
  private workerRafId: number | null = null;
  private followTailRafId: number | null = null;
  private pinnedTailGuardRafId: number | null = null;
  private pinnedTailGuardIterations = 0;
  private isFlushingQueue = false;
  private tailSettle: TailSettleState | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private prevEventCount = 0;
  private prevTailKey: string | null = null;
  private prevScrollHeight = 0;
  private wasLoadingOlder = false;
  private hasInitialScroll = false;
  private loadOlderIntent: LoadOlderIntent = 'preserve_position';
  /** Set when preserve_position load starts; cleared after prepend is handled. */
  private pendingPrependPreserve = false;
  private prependAnchor: PrependScrollAnchor | null = null;
  private prependSettleRafId: number | null = null;
  private scrollSnapshot: ScrollSnapshot | null = null;

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

  /** Whether tail follow should run on append (pinned and flush at the tail). */
  shouldFollowTail(): boolean {
    if (this.pendingPrependPreserve || this.wasLoadingOlder) {
      return false;
    }
    return this.pinned && this.computeIsAtBottom();
  }

  getAllowLoadOlder(): boolean {
    // Deprecated alias — scroll-driven load uses isProgrammaticScrollActive() instead.
    return !this.programmaticScroll;
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

  /** Reset pagination/scroll bookkeeping when switching chatrooms (coordinator ref persists). */
  resetForChatroom(): void {
    this.cancelPendingTailWork();

    if (this.prependSettleRafId !== null) {
      cancelAnimationFrame(this.prependSettleRafId);
      this.prependSettleRafId = null;
    }

    this.prevEventCount = 0;
    this.prevTailKey = null;
    this.prevScrollHeight = 0;
    this.wasLoadingOlder = false;
    this.hasInitialScroll = false;
    this.loadOlderIntent = 'preserve_position';
    this.pendingPrependPreserve = false;
    this.prependAnchor = null;
    this.scrollSnapshot = null;
  }

  // fallow-ignore-next-line unused-class-member
  hasScrollSnapshot(): boolean {
    return this.scrollSnapshot !== null;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  attach(el: HTMLElement): void {
    if (this.el) {
      this.detach();
    }

    this.el = el;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.pinned && !this.resizing && this.computeIsAtBottom()) {
        this.enqueue({ type: 'snap' });
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

    if (this.workerRafId !== null) {
      cancelAnimationFrame(this.workerRafId);
      this.workerRafId = null;
    }

    this.stopPinnedTailGuard();

    if (this.prependSettleRafId !== null) {
      cancelAnimationFrame(this.prependSettleRafId);
      this.prependSettleRafId = null;
    }

    this.intentQueue.length = 0;
    this.tailSettle = null;
    this.captureScrollSnapshot();
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
      this.enqueue({ type: 'follow_tail', behavior: 'auto' });
      this.enqueue({ type: 'tail_settle' });
      this.schedulePinnedTailGuard();
    }
  }

  // ─── User actions ────────────────────────────────────────────────────────

  /** Jump chip — pin immediately, snap to max with auto, then settle + guard as rows measure in. */
  jumpToEnd(): void {
    this.setPinned(true);
    this.runProgrammaticScroll(
      () => {
        this.applyTailScroll('auto');
      },
      { targetCheck: () => this.computeIsAtBottom() }
    );
    this.enqueue({ type: 'tail_settle' });
    this.schedulePinnedTailGuard();
  }

  /**
   * Re-settle tail when the last row grows in-place (classification, content, footer measure-in).
   * No-op when not pinned at bottom or during prepend/load-older preservation.
   */
  notifyTailRowResized(tailIndex?: number): void {
    if (!this.shouldFollowTail()) {
      return;
    }
    this.enqueue({ type: 'tail_settle', tailIndex });
  }

  /** Preserve viewport when top chrome height changes (load-older spinner). No-op at tail. */
  notifyTopChromeDelta(deltaPx: number): void {
    if (deltaPx === 0 || this.computeIsAtBottom()) {
      return;
    }
    this.enqueue({ type: 'adjust_top_chrome', deltaPx });
  }

  /**
   * Pinned tail follow — DOM snap + virtualizer (stable as rows measure in).
   */
  followTail(behavior: 'auto' | 'smooth' = 'auto'): void {
    this.setPinned(true);
    this.enqueue({ type: 'follow_tail', behavior });
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
      countIncreased && (this.wasLoadingOlder || isLoadingOlder || this.pendingPrependPreserve);

    if (eventCount > 0 && !this.hasInitialScroll) {
      this.hasInitialScroll = true;
      if (this.tryRestoreScrollSnapshot()) {
        return;
      }
      if (this.pinned) {
        this.enqueue({ type: 'tail_settle' });
        this.schedulePinnedTailGuard();
      }
    } else if (scrollEl && (countIncreased || tailChanged)) {
      if (isPrependWhileLoadingOlder) {
        if (this.loadOlderIntent === 'fill_viewport') {
          this.followTail('auto');
          this.loadOlderIntent = 'preserve_position';
          this.pendingPrependPreserve = false;
          this.prependAnchor = null;
        } else {
          this.enqueue({ type: 'preserve_prepend', scrollEl });
        }
      } else if (this.pinned) {
        // Tail key covers subscription slide-off (same count); count covers growth without tail rotation.
        // Match jumpToEnd: follow_tail + tail_settle for variable-height rows (context dividers, handoffs).
        const tailIndex = eventCount > 0 ? eventCount - 1 : undefined;
        this.enqueue({ type: 'follow_tail', behavior: 'auto' });
        this.enqueue({ type: 'tail_settle', tailIndex });
        this.schedulePinnedTailGuard();
      }

      this.prevScrollHeight = scrollEl.scrollHeight;
    } else if (scrollEl) {
      this.prevScrollHeight = scrollEl.scrollHeight;
    }

    this.prevEventCount = eventCount;
    this.prevTailKey = tailKey;
    this.wasLoadingOlder = isLoadingOlder;
  }

  // ─── Intent queue ────────────────────────────────────────────────────────

  private enqueue(intent: ScrollIntent): void {
    this.intentQueue.push(intent);
    if (!this.isFlushingQueue) {
      this.flushQueue();
    }
  }

  private scheduleWorker(): void {
    if (this.workerRafId !== null) return;
    this.workerRafId = requestAnimationFrame(() => {
      this.workerRafId = null;
      this.flushQueue();
    });
  }

  private cancelPendingTailWork(): void {
    for (let i = this.intentQueue.length - 1; i >= 0; i--) {
      const intent = this.intentQueue[i];
      if (
        intent.type === 'follow_tail' ||
        intent.type === 'tail_settle' ||
        intent.type === 'snap'
      ) {
        this.intentQueue.splice(i, 1);
      }
    }
    if (this.workerRafId !== null) {
      cancelAnimationFrame(this.workerRafId);
      this.workerRafId = null;
    }
    if (this.followTailRafId !== null) {
      cancelAnimationFrame(this.followTailRafId);
      this.followTailRafId = null;
    }
    this.stopPinnedTailGuard();
    this.tailSettle = null;
    this.programmaticScrollDepth = 0;
    this.programmaticScroll = false;
  }

  private isTailBlockedByPrepend(): boolean {
    return this.pendingPrependPreserve || this.prependSettleRafId !== null;
  }

  private flushQueue(): void {
    if (this.isFlushingQueue) return;
    this.isFlushingQueue = true;

    let needsAnotherFrame = false;

    try {
      needsAnotherFrame = this.runFlushCycle();
    } finally {
      this.isFlushingQueue = false;
    }

    if (this.intentQueue.length > 0) {
      this.flushQueue();
      return;
    }

    if (needsAnotherFrame) {
      this.scheduleWorker();
    }
  }

  /** One coalesced apply pass; returns true when tail settle needs another animation frame. */
  private runFlushCycle(): boolean {
    let needsAnotherFrame = false;

    // Process cancellations first.
    for (let i = this.intentQueue.length - 1; i >= 0; i--) {
      if (this.intentQueue[i].type === 'cancel_programmatic') {
        this.intentQueue.splice(i, 1);
        this.cancelPendingTailWork();
      }
    }

    const blockTail = this.isTailBlockedByPrepend();

    // Drain prepend / chrome intents before tail work.
    for (let i = 0; i < this.intentQueue.length;) {
      const intent = this.intentQueue[i];
      if (intent.type === 'preserve_prepend') {
        this.intentQueue.splice(i, 1);
        this.applyPrependScrollPreserve(intent.scrollEl);
      } else if (intent.type === 'adjust_top_chrome') {
        this.intentQueue.splice(i, 1);
        this.applyTopChromeDelta(intent.deltaPx);
      } else {
        i++;
      }
    }

    // Coalesce tail-related intents for this frame (last follow_tail behavior wins).
    let followBehavior: 'auto' | 'smooth' | null = null;
    let snap = false;
    const tailSettleIntents: Extract<ScrollIntent, { type: 'tail_settle' }>[] = [];

    for (let i = this.intentQueue.length - 1; i >= 0; i--) {
      const intent = this.intentQueue[i];
      if (
        intent.type === 'follow_tail' ||
        intent.type === 'tail_settle' ||
        intent.type === 'snap'
      ) {
        this.intentQueue.splice(i, 1);
        if (blockTail) continue;
        if (intent.type === 'follow_tail') {
          followBehavior = intent.behavior;
        } else if (intent.type === 'snap') {
          snap = true;
        } else {
          tailSettleIntents.unshift(intent);
        }
      }
    }

    if (tailSettleIntents.length > 0) {
      const merged = tailSettleIntents.reduce(
        (acc, intent) => ({
          tailIndex: intent.tailIndex ?? acc.tailIndex,
          maxFrames: intent.maxFrames ?? acc.maxFrames,
          onSettled: intent.onSettled
            ? () => {
                acc.onSettled?.();
                intent.onSettled?.();
              }
            : acc.onSettled,
        }),
        {} as { tailIndex?: number; maxFrames?: number; onSettled?: () => void }
      );
      this.startTailSettle(merged);
    }

    if (!blockTail && (followBehavior !== null || snap)) {
      const behavior = followBehavior ?? 'auto';
      if (followBehavior !== null) {
        this.setPinned(true);
      }
      this.applyFollowTailIntent(behavior);
    }

    if (this.tailSettle !== null) {
      needsAnotherFrame = this.tickTailSettle();
    }

    return needsAnotherFrame;
  }

  private startTailSettle(options: {
    tailIndex?: number;
    onSettled?: () => void;
    maxFrames?: number;
  }): void {
    this.tailSettle = {
      frames: 0,
      maxFrames: options.maxFrames ?? TAIL_SETTLE_MAX_FRAMES,
      tailIndex: options.tailIndex,
      onSettled: options.onSettled,
    };

    if (this.pinned && this.el) {
      this.applyFollowTailIntent('auto', options.tailIndex);
    }
  }

  /** Returns true when tail settle should continue on the next frame. */
  private tickTailSettle(): boolean {
    const state = this.tailSettle;
    if (!state) return false;

    state.frames++;
    const visibleCount = this.virtualizer?.getVisibleCount?.() ?? 1;
    const rangeEmpty = visibleCount === 0;
    const atBottom = this.computeIsAtBottom();

    if (this.pinned && this.el && (!atBottom || rangeEmpty)) {
      this.applyFollowTailIntent('auto', state.tailIndex);
    }

    const settled = atBottom && !rangeEmpty && state.frames >= 2;
    if (settled || state.frames >= state.maxFrames) {
      const onSettled = state.onSettled;
      this.tailSettle = null;
      onSettled?.();
      return false;
    }

    return true;
  }

  private applyFollowTailIntent(behavior: 'auto' | 'smooth', tailIndex?: number): void {
    this.runProgrammaticScroll(
      () => {
        this.applyTailScroll(behavior, tailIndex);
      },
      { targetCheck: () => this.computeIsAtBottom() }
    );
    if (this.followTailRafId !== null) {
      cancelAnimationFrame(this.followTailRafId);
    }
    this.followTailRafId = requestAnimationFrame(() => {
      this.followTailRafId = null;
      if (!this.pinned || this.isTailBlockedByPrepend()) {
        return;
      }
      this.applyTailScroll(behavior, tailIndex);
    });
  }

  /** While pinned, correct scrollTop below max via the intent queue (no separate React watchdog). */
  private schedulePinnedTailGuard(): void {
    if (this.pinnedTailGuardRafId !== null) return;
    if (!this.canRunPinnedTailGuard()) return;

    this.pinnedTailGuardIterations = 0;
    this.pinnedTailGuardRafId = requestAnimationFrame(() => this.tickPinnedTailGuard());
  }

  private stopPinnedTailGuard(): void {
    if (this.pinnedTailGuardRafId !== null) {
      cancelAnimationFrame(this.pinnedTailGuardRafId);
      this.pinnedTailGuardRafId = null;
    }
    this.pinnedTailGuardIterations = 0;
  }

  private canRunPinnedTailGuard(): boolean {
    return (
      this.pinned &&
      !this.resizing &&
      !this.userScrolling &&
      !this.isTailBlockedByPrepend() &&
      this.el !== null
    );
  }

  private isBelowMaxScroll(): boolean {
    if (!this.el) return false;
    return this.el.scrollTop < this.getMaxScrollTop() - 0.5;
  }

  private tickPinnedTailGuard(): void {
    this.pinnedTailGuardRafId = null;

    if (!this.canRunPinnedTailGuard()) {
      this.pinnedTailGuardIterations = 0;
      return;
    }

    if (this.isBelowMaxScroll()) {
      this.pinnedTailGuardIterations++;
      if (this.pinnedTailGuardIterations <= PINNED_TAIL_GUARD_MAX_ITERATIONS) {
        this.enqueue({ type: 'follow_tail', behavior: 'auto' });
        this.enqueue({ type: 'tail_settle' });
      }
    } else {
      this.pinnedTailGuardIterations = 0;
      return;
    }

    if (this.canRunPinnedTailGuard() && this.isBelowMaxScroll()) {
      this.pinnedTailGuardRafId = requestAnimationFrame(() => this.tickPinnedTailGuard());
    }
  }

  /** Single DOM + virtualizer apply path for tail follow / snap / settle. */
  private applyTailScroll(behavior: 'auto' | 'smooth', tailIndex?: number): void {
    if (tailIndex !== undefined && tailIndex >= 0) {
      this.virtualizer?.scrollToIndex?.(tailIndex, { align: 'end', behavior: 'auto' });
    }
    this.scrollVirtualizer(behavior);
    this.snapDomImmediate();
    this.syncVirtualizerScrollFromDom();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private captureScrollSnapshot(): void {
    if (!this.el) return;
    this.scrollSnapshot = {
      scrollTop: this.el.scrollTop,
      pinned: this.pinned,
    };
  }

  /** Restore saved scroll position after remounting a view tab. Returns true when restored. */
  private tryRestoreScrollSnapshot(): boolean {
    if (!this.el || !this.scrollSnapshot) return false;

    const { scrollTop, pinned } = this.scrollSnapshot;
    this.setPinned(pinned);
    this.runProgrammaticScroll(() => {
      if (!this.el) return;
      this.el.scrollTop = scrollTop;
      this.syncVirtualizerScrollFromDom();
    });
    return true;
  }

  private setPinned(pinned: boolean): void {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    if (pinned) {
      this.schedulePinnedTailGuard();
    } else {
      this.stopPinnedTailGuard();
    }
    for (const listener of this.pinListeners) {
      listener();
    }
  }

  private scrollVirtualizer(behavior: 'auto' | 'smooth'): void {
    this.virtualizer?.scrollToEnd({ behavior });
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
  private applyTopChromeDelta(deltaPx: number): void {
    if (!this.el || deltaPx === 0 || this.computeIsAtBottom()) {
      return;
    }

    const el = this.el;
    this.runProgrammaticScroll(() => {
      el.scrollTop += deltaPx;
      this.virtualizer?.scrollToOffset?.(el.scrollTop, { behavior: 'auto' });
      this.syncVirtualizerScrollFromDom();
    });
  }

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

  private schedulePrependScrollSettle(scrollEl: HTMLElement, anchor: PrependScrollAnchor): void {
    if (this.prependSettleRafId !== null) {
      cancelAnimationFrame(this.prependSettleRafId);
    }

    let frames = 0;

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

      if (frames >= PREPEND_SETTLE_MAX_FRAMES) {
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

  private beginProgrammaticScroll(): void {
    this.programmaticScrollDepth++;
    this.programmaticScroll = true;
  }

  private endProgrammaticScroll(): void {
    this.programmaticScrollDepth = Math.max(0, this.programmaticScrollDepth - 1);
    if (this.programmaticScrollDepth === 0) {
      this.programmaticScroll = false;
    }
  }

  /**
   * Programmatic scroll with two clear strategies:
   *
   * 1. **Tail/jump scrolls** — caller provides `targetCheck`. The `programmaticScroll`
   *    flag is cleared as soon as `targetCheck()` returns true (or after the hard frame
   *    cap). Used by `jumpToEnd`, `applyFollowTailIntent`, and `tail_settle` to keep
   *    the flag active only while scrolling to the bottom.
   *
   * 2. **Mid-list scrolls** — no `targetCheck` (e.g. `applyPrependScrollTop` at ~line 700).
   *    Falls back to a fixed 2-rAF window. These scrolls do NOT target the bottom,
   *    so a target-check would be incorrect; the fixed window is sufficient because
   *    mid-list scrolls are short-lived and do not compete with tail follow.
   */
  private runProgrammaticScroll(
    action: () => void,
    options: { targetCheck?: () => boolean } = {}
  ): void {
    this.beginProgrammaticScroll();
    action();

    const { targetCheck } = options;
    if (!targetCheck) {
      // Fallback: clear after 2 rAFs (preserves existing behavior for mid-list scrolls).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.endProgrammaticScroll();
        });
      });
      return;
    }

    // Parameterized clear: drop the flag as soon as the caller's target is hit
    // (or after a hard cap so we never deadlock pin updates).
    let frames = 0;
    const tick = (): void => {
      frames++;
      if (targetCheck()) {
        this.endProgrammaticScroll();
        return;
      }
      if (frames >= PROGRAMMATIC_SCROLL_CLEAR_MAX_FRAMES) {
        this.endProgrammaticScroll();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
    // Defer the synthetic scroll event so it does not fire inside a React lifecycle
    // (e.g. useLayoutEffect). TanStack Virtual caches its scrollOffset from scroll events;
    // a microtask is fast enough to maintain scroll-state consistency while avoiding
    // the "flushSync called from inside a lifecycle method" React warning.
    const el = this.el;
    queueMicrotask(() => el.dispatchEvent(new Event('scroll')));
  }

  private computeIsAtBottom(): boolean {
    if (!this.el) return false;
    const { scrollTop, scrollHeight, clientHeight } = this.el;
    if (scrollHeight <= clientHeight) return false;
    return scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;
  }

  private handleUserScroll = (): void => {
    this.stopPinnedTailGuard();
    this.enqueue({ type: 'cancel_programmatic' });
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
    const atBottom = this.computeIsAtBottom();

    if (
      !atBottom &&
      this.pinned &&
      this.tailSettle === null &&
      !this.isFlushingQueue &&
      !this.programmaticScroll
    ) {
      this.cancelPendingTailWork();
      this.setPinned(false);
      return;
    }

    if (this.programmaticScroll) return;

    if (atBottom && !this.pinned) {
      this.setPinned(true);
      return;
    }

    if (this.userScrolling) return;
  };
}
