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

## Phase 2 — Stop synthetic-scroll dispatch from steady-state tail follow (LOW-MEDIUM)

**Goal:** remove `this.el.dispatchEvent(new Event('scroll'))` from `followTail()`. Keep it in `applyPrependScrollTop()` where it's needed.

**Rationale:** at scrollHeight - clientHeight (the maximum), TanStack's range computation is well-defined regardless of cached offset. The synthetic dispatch is only load-bearing in mid-list (prepend) positions.

**Mechanism:** drop `syncVirtualizerScrollFromDom()` calls inside `followTail`.

**Verify checklist:**
- Pinned + new message: still follows tail.
- Click jump chip from scrolled-up: still scrolls + re-pins.
- Resize textarea while pinned: still re-snaps to bottom.
- First-paint tail land: still lands on latest message.

**Diff size:** ~5 lines.

## Phase 3 — Tighten `runProgrammaticScroll` window (MEDIUM)

**Goal:** clear `programmaticScroll` when DOM scrollTop matches the intended target OR after a hard frame cap, instead of after 2 rAFs.

**Caveat:** assumes scrolls target `getMaxScrollTop()`. Need to parameterize or skip for `applyPrependScrollTop` (mid-list target).

**Verify checklist:**
- Click jump chip on long history: smooth animation runs, pin stays true throughout, chip disappears at end.
- All Phase 1+2 checks pass.

**Diff size:** ~25 lines.

## Phase 4 — Replace `userScrolling` 200 ms timeout with TanStack `isScrolling` (MEDIUM)

**Goal:** delete `handleUserScroll`, `userScrolling`, `userScrollTimeout`, `wheel`/`touchmove` listeners. Gate `handleScrollEvent` on TanStack's `instance.isScrolling`.

**Verify checklist:**
- Mouse wheel scroll up from tail: no pin-flicker, no jump chip flash.
- iOS touchpad inertial scroll: still un-pins correctly.
- All previous checks.

**Diff size:** ~40 lines (mostly removals).

## Phase 5 — Replace eager-measure tick with `initialMeasurementsCache` (MEDIUM)

**Goal:** delete the 8-frame `eagerMeasureDoneRef` loop in the feed. Use TanStack's `initialMeasurementsCache` option fed from the Phase 1 cache.

**Mechanism:** build `initialMeasurementsCache` from `measurementCacheRef` on first mount.

**Verify checklist:**
- Initial load: small feed (≤40 messages) lands on latest message reliably.
- All previous checks.

**Diff size:** ~50 lines (mostly removals).

## Phase 6 — Reduce `scheduleTailSettle` max-frames from 24 to 6 (LOW after 1+5)

**Goal:** `maxFrames = options.maxFrames ?? 6`. Settle exits at first stable frame; cap reduction prevents pathological loops.

**Verify checklist:**
- Hard reload with cache disabled: initial load still lands on latest.

**Diff size:** 1 line.

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
