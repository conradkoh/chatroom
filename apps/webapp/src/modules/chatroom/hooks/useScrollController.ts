'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Constants ──────────────────────────────────
const AT_BOTTOM_THRESHOLD = 50;
const USER_SCROLL_TIMEOUT_MS = 200;

// ─── Types ──────────────────────────────────────
type PinnedChangeCallback = (pinned: boolean) => void;

// ─── ScrollController ───────────────────────────

/**
 * Centralised scroll-management state machine for the message feed.
 *
 * Responsibilities:
 * - Track whether the feed is "pinned" to the bottom
 * - Snap to bottom on new messages / resize (when pinned)
 * - Preserve scroll position on load-more (paginate up)
 * - Distinguish programmatic scrolls from user scrolls (wheel/touch)
 * - Expose a smooth "scroll to bottom" action for the floating button
 */
export class ScrollController {
  // ─── State ──────────────────────────────────
  private pinned = true;
  private userScrolling = false;
  private userScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private resizing = false;

  // ─── DOM ────────────────────────────────────
  private el: HTMLElement | null = null;

  // ─── Action queue (rAF-based) ───────────────
  private pendingSnap = false;
  private rafId: number | null = null;

  // ─── Observers ──────────────────────────────
  private resizeObserver: ResizeObserver | null = null;

  // ─── React state sync ──────────────────────
  private onPinnedChange: PinnedChangeCallback;

  constructor(onPinnedChange: PinnedChangeCallback) {
    this.onPinnedChange = onPinnedChange;
  }

  // ─── Public API ─────────────────────────────

  /**
   * Attach to a DOM element.
   * Sets up ResizeObserver and wheel / touch / scroll listeners.
   */
  attach(el: HTMLElement): void {
    // Detach any previous element first
    if (this.el) {
      this.detach();
    }

    this.el = el;

    // ResizeObserver — snap when pinned and the container resizes
    // (e.g., textarea height changes cause the feed container to shrink/grow)
    // Skip during active textarea resize (beginResize/endResize bracket)
    this.resizeObserver = new ResizeObserver(() => {
      if (this.pinned && !this.resizing) {
        this.enqueueSnap();
      }
    });
    this.resizeObserver.observe(el);

    // User-initiated scroll detection (wheel / touch)
    el.addEventListener('wheel', this.handleUserScroll, { passive: true });
    el.addEventListener('touchmove', this.handleUserScroll, { passive: true });

    // Generic scroll event — re-pin detection
    el.addEventListener('scroll', this.handleScrollEvent, { passive: true });
  }

  /**
   * Detach from DOM. Tears down all observers and listeners.
   */
  detach(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

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
  }

  /** Get current pinned state */
  get isPinned(): boolean {
    return this.pinned;
  }

  /**
   * Called when new messages arrive (from useLayoutEffect).
   *
   * @param heightDiff   Change in scrollHeight since last render
   * @param wasLoadingMore  True if we were paginating up
   * @param wasNearTop    True if scrollTop < 200 before the update
   */
  onNewMessages(
    heightDiff: number,
    wasLoadingMore: boolean,
    wasNearTop: boolean
  ): void {
    if (!this.el) return;

    if (wasLoadingMore || wasNearTop) {
      // Preserve scroll position — offset by the height of newly-inserted content
      this.el.scrollTop += heightDiff;
    } else if (this.pinned) {
      // Pinned → snap to bottom immediately (synchronous for useLayoutEffect)
      this.snapImmediate();
    }
  }

  /** Called when queue section changes size */
  onQueueChange(): void {
    if (this.pinned) {
      this.enqueueSnap();
    }
  }

  /**
   * Called when user clicks "scroll to bottom" button.
   * Re-pins and smooth-scrolls to the bottom.
   */
  scrollToBottom(): void {
    if (!this.el) return;

    this.pinned = true;
    this.onPinnedChange(true);
    this.el.scrollTo({ top: this.el.scrollHeight, behavior: 'smooth' });
  }

  /**
   * Called from the onScroll handler — only returns scroll position for
   * load-more checks. NO snap-back. NO re-pin (that happens internally).
   */
  getScrollPosition(): { scrollTop: number } | null {
    if (!this.el) return null;
    return { scrollTop: this.el.scrollTop };
  }

  /**
   * Called before the textarea begins resizing.
   * Prevents the ResizeObserver from enqueuing snap-backs during the resize.
   */
  beginResize(): void {
    this.resizing = true;
  }

  /**
   * Called after the textarea finishes resizing.
   * Clears the resizing flag and, if pinned, snaps to bottom synchronously.
   */
  endResize(): void {
    this.resizing = false;
    if (this.pinned) {
      this.snapImmediate();
    }
  }

  // ─── Private ────────────────────────────────

  /** Enqueue a snap-to-bottom in the next animation frame */
  private enqueueSnap(): void {
    this.pendingSnap = true;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.processQueue();
      });
    }
  }

  /** Process the pending action (called via rAF) */
  private processQueue(): void {
    if (this.pendingSnap && this.pinned && this.el) {
      this.el.scrollTop = this.el.scrollHeight;
    }

    this.pendingSnap = false;
    this.rafId = null;
  }

  /** Immediately set scrollTop to bottom (synchronous, for useLayoutEffect) */
  private snapImmediate(): void {
    if (this.el) {
      this.el.scrollTop = this.el.scrollHeight;
    }
  }

  /** Check whether the scroll container is at the bottom (within threshold) */
  private isAtBottom(): boolean {
    if (!this.el) return false;
    const { scrollTop, scrollHeight, clientHeight } = this.el;
    return scrollHeight - scrollTop - clientHeight < AT_BOTTOM_THRESHOLD;
  }

  /**
   * Handle wheel / touchmove — mark as user-initiated scroll.
   * Sets `userScrolling = true` synchronously (before the scroll event fires).
   * After 200ms of inactivity, checks if user has scrolled away from bottom.
   */
  private handleUserScroll = (): void => {
    this.userScrolling = true;

    if (this.userScrollTimeout !== null) {
      clearTimeout(this.userScrollTimeout);
    }

    this.userScrollTimeout = setTimeout(() => {
      this.userScrolling = false;
      this.userScrollTimeout = null;

      // After the user stops scrolling, check if they left the bottom
      if (!this.isAtBottom() && this.pinned) {
        this.pinned = false;
        this.onPinnedChange(false);
      }
    }, USER_SCROLL_TIMEOUT_MS);
  };

  /**
   * Handle scroll event — re-pin if at bottom (only when not user-scrolling).
   * This catches programmatic scrolls (smooth scroll-to-bottom, etc.).
   */
  private handleScrollEvent = (): void => {
    if (this.isAtBottom() && !this.userScrolling && !this.pinned) {
      this.pinned = true;
      this.onPinnedChange(true);
    }
  };
}

// ─── React Hook ─────────────────────────────────

/**
 * Hook that creates and manages a ScrollController instance.
 *
 * Returns:
 * - `controller` — ref to the ScrollController (pass to attach/detach)
 * - `isPinned`   — React state for driving UI (floating button visibility)
 * - `scrollToBottom` — stable callback for the button's onClick
 * - `beginResize` — call before textarea resize starts
 * - `endResize`   — call after textarea resize completes
 */
export function useScrollController(): {
  controller: React.MutableRefObject<ScrollController>;
  isPinned: boolean;
  scrollToBottom: () => void;
  beginResize: () => void;
  endResize: () => void;
} {
  const [isPinned, setIsPinned] = useState(true);
  const controllerRef = useRef<ScrollController>(new ScrollController(setIsPinned));

  // Cleanup on unmount
  useEffect(() => {
    return () => controllerRef.current.detach();
  }, []);

  const scrollToBottom = useCallback(() => {
    controllerRef.current.scrollToBottom();
  }, []);

  const beginResize = useCallback(() => {
    controllerRef.current.beginResize();
  }, []);

  const endResize = useCallback(() => {
    controllerRef.current.endResize();
  }, []);

  return { controller: controllerRef, isPinned, scrollToBottom, beginResize, endResize };
}
