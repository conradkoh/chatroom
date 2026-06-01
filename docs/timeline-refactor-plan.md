# Timeline Scroll Refactor — Phased Plan

Ordered by **increasing risk** and **decreasing certainty**. Each phase is independently shippable, revertable, and small enough to verify in <5 minutes per round. After each phase, user verifies in production and says "good" or "bad" — we continue or revert.

Hard rules:
- One phase = one PR off `release/v1.51.0` (or the current release branch).
- Each PR has a single revertable commit.
- Do not proceed to the next phase until the previous one is confirmed in real-app testing.
- If "bad" at any phase, revert and stop. Earlier confirmed phases stay.

## Phase 1 — In-memory measurement cache (LOW RISK)

**Goal:** persist row measurements across virtualizer reconciliations within a session, so re-rendered rows use real cached heights instead of `TIMELINE_ESTIMATE_SIZE = 100`.

**Mechanism:**

```ts
const measurementCacheRef = useRef<Map<string, number>>(new Map());

const virtualizer = useVirtualizer({
  // ...
  estimateSize: (index) => {
    const event = events[index];
    if (!event) return TIMELINE_ESTIMATE_SIZE;
    return measurementCacheRef.current.get(event.id) ?? TIMELINE_ESTIMATE_SIZE;
  },
});

useEffect(() => {
  const cache = measurementCacheRef.current;
  for (const item of virtualizer.getVirtualItems()) {
    const e = events[item.index];
    if (e && item.size > 0) cache.set(e.id, item.size);
  }
});
```

**Fixes:** load-older anchor drift caused by under-estimated prepended rows.

**Verify checklist:**
- Initial load: latest messages visible.
- Pinned + new message: stays at tail.
- Load older: viewport stays on the same row (less anchor drift than today).
- Scroll up to top, scroll back down — no rendering surprises.

**Diff size:** ~15 lines.

## Phase 2 — Stop synthetic-scroll dispatch from steady-state tail follow (TRIED — REVERTED)

**Tried:** dropped both `syncVirtualizerScrollFromDom()` calls from `followTail()`.

**Result:** broke three user-observable behaviors:
1. Pinned + send message: view did not fully scroll to include the new message (TanStack's cached `scrollOffset` was stale, so the `wasAtEnd` check in `shouldAdjustScrollPositionOnItemSizeChange` failed to fire as new rows measured in).
2. Scroll-up felt more stuttery (cached offset drift between scroll events).
3. Agent-response arrival did not show jump-to-new-message chip when user was scrolled up.

**Conclusion:** `syncVirtualizerScrollFromDom()` is load-bearing inside `followTail()`. TanStack's cached `scrollOffset` must be kept in sync with the DOM whenever we write `scrollTop` directly; otherwise downstream callbacks (`shouldAdjustScrollPositionOnItemSizeChange`, range computation, etc.) read stale state. Do not retry this without a different approach (e.g. driving scroll through TanStack only and never via `el.scrollTop = …`).

**Status:** abandoned.

## Phase 3 — Tighten `runProgrammaticScroll` window (MEDIUM)

**Goal:** clear `programmaticScroll` when DOM scrollTop matches the intended target OR after a hard frame cap, instead of after 2 rAFs.

**Caveat:** assumes scrolls target `getMaxScrollTop()`. Need to parameterize or skip for `applyPrependScrollTop` (mid-list target).

**Verify checklist:**
- Click jump chip on long history: smooth animation runs, pin stays true throughout, chip disappears at end.
- All Phase 1+2 checks pass.

**Diff size:** ~25 lines.

## Phase 4 — Replace `userScrolling` 200 ms timeout with TanStack `isScrolling` (TRIED — REVERTED)

**Tried:** removed the wheel/touchmove early-gating + 200 ms userScrolling timeout. Gated `handleScrollEvent` on `virtualizer.isScrolling` instead.

**Result:** blank rows, rows flashing then going blank during scroll. Behavior was reportedly broken to the point of being hard to characterize further.

**Hypotheses:**
1. The deleted `wheel`/`touchmove` listeners' debounced reconciliation (setPinned at the end of the 200 ms timeout) reconciled pin state AFTER the user's scroll gesture ended. TanStack's `isScrolling` debounces too, but no scroll event fires after scrolling stops, so the post-scroll reconciliation never runs. Pin state can become wrong, which then triggers an erroneous `followTail` on the next data update.
2. Removing the wheel/touchmove listeners may have changed event-listener order or removed some side effect TanStack relies on. Unclear without browser debugging.

**Conclusion:** the wheel/touchmove early-gating is structurally needed. Even though TanStack's `isScrolling` exists, it's not a drop-in replacement — the timing and side-effect semantics differ. Do not retry this without re-thinking the pin-state reconciliation as a whole (likely part of Phase 7's tail-follow consolidation, not a standalone change).

**Status:** abandoned.

## Phase 5 — Replace eager-measure tick with `initialMeasurementsCache` (MEDIUM)

**Goal:** delete the 8-frame `eagerMeasureDoneRef` loop in the feed. Use TanStack's `initialMeasurementsCache` option fed from the Phase 1 cache.

**Mechanism:** build `initialMeasurementsCache` from `measurementCacheRef` on first mount.

**Verify checklist:**
- Initial load: small feed (≤40 messages) lands on latest message reliably.
- All previous checks.

**Diff size:** ~50 lines (mostly removals).

## Phase 6 — Reduce `scheduleTailSettle` max-frames from 24 to 6 (TRIED — REVERTED)

**Tried:** lowered the cap from 24 frames to 6.

**Result:** during real-app testing, user observed that big messages caused noticeable content jumping. It's not certain Phase 6 was the cause — the "competing scroll writers" architectural pattern documented above can produce jumping regardless of cap — but lowering the cap removes the worst-case recovery window that the system relies on when measurements take a long time to converge (font load, large markdown render, image load all contribute).

**Conclusion:** the 24-frame cap is doing real work for the worst-case path. With Phases 1+5 in place, the common case settles in 2-3 frames anyway, so the high cap is only paid when needed. Keep the 24-frame cap.

**Status:** abandoned. Net negative tradeoff.

## Architectural observation — competing scroll writers

During Phase 3 verification, user noted that very tall messages render with a small jump and a brief scroll stutter that "correctly settles." This is a system-level symptom of multiple paths competing for control of the scroll element's `scrollTop`:

1. **`snapDomImmediate` and `applyPrependScrollTop`** — write `el.scrollTop` directly.
2. **TanStack Virtual** — writes `el.scrollTop` via its `scrollToFn` / `elementScroll` when invoked through `scrollToEnd`, `scrollToOffset`, `scrollToIndex`.
3. **TanStack's `shouldAdjustScrollPositionOnItemSizeChange`** — writes `el.scrollTop` via `applyScrollAdjustment` when a row's measured size differs from estimate.
4. **The browser's own scroll updates** — user wheel/touch input.
5. **The `wasAtEnd` path inside TanStack** — writes scrollTop when `anchorTo:'end'` is active and a size change extends the total length.

Sources 1–3 and 5 are all our own writes; the order they fire and the order they read each other's effects is what produces the visible stutter for tall content. There is no single-phase fix because each write is load-bearing for a different scenario. The synthetic `dispatchEvent('scroll')` in `syncVirtualizerScrollFromDom()` is what keeps sources 1 and 2/3/5 consistent (Phase 2 confirmed this is non-negotiable). A real fix would route ALL scroll writes through TanStack and remove sources 1, but that requires giving up the pixel-precise prepend preservation, which is a behavior change. Out of scope for this refactor.

**Status:** known limitation. Tracked for a future redesign that picks a single scroll authority.

## Phase 7 — Consolidate 4 tail-follow paths into 1 (HIGH RISK — do not start without explicit go-ahead)

**Goal:** merge `commit.followTail`, `ResizeObserver.enqueueSnap`, `endResize`, and `scheduleTailSettle` into a single `requestTailFollow({ reason })` with debouncing.

**Risk:** high. Touches the most-tested area.

**Diff size:** ~80 lines.

## Phase 8 — Drop `shouldAdjustScrollPositionOnItemSizeChange` override (HIGH RISK)

**Goal:** rely on TanStack's default `itemStart < scrollOffset && scrollDirection !== 'backward'`.

**Risk:** high. This is what PR #600 tried; broke initial load. With Phase 1's cache, the default might work — but verifying requires careful manual scroll-up testing.

## Recommended ship order

Phases 1, 2, 6 are the lowest-risk wins. Land them sequentially, each as its own PR. After that, decide whether 3-5 are worth pursuing. 7-8 are "next release" rewrites.

## Process

- One phase in flight at a time.
- Each phase on its own branch off the current release.
- User verifies in production app before next phase starts.
- If user reports a bug in a shipped phase, revert that PR.
