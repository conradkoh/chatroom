# Plan 005: UI/UX Bug Fixes - Implementation Phases

## Phase Breakdown

| Phase | Bug | File | Estimated Effort |
|-------|-----|------|------------------|
| 1 | Loading cards not clickable | ChatroomSelector.tsx | Small |
| 2 | Menu overlapping status badge | ChatroomSelector.tsx | Small |
| 3 | Tables/markdown horizontal scroll | MessageFeed.tsx | Small |
| 4 | Emoji circles in status icons | MessageFeed.tsx | Small |

---

## Phase 1: Fix Loading Cards Not Clickable

### Objective
Make chatroom cards clickable immediately while still loading agent statuses.

### Current Behavior
- Loading skeleton card uses a `<div>` instead of `<button>`
- Card is not clickable until participants data loads

### Required Changes

**File:** `apps/webapp/src/modules/chatroom/components/ChatroomSelector.tsx`

1. Change the loading skeleton card from `<div>` to `<button>` (lines 298-326)
2. Add `onClick={() => onSelect(chatroom._id)}` to the loading card
3. Keep the same styling but add `cursor-pointer` and hover states

### Success Criteria
- [ ] Loading cards are clickable before agent statuses load
- [ ] Click navigates to chatroom view
- [ ] Hover states work on loading cards

---

## Phase 2: Fix Menu Overlapping Status Badge

### Objective
Prevent the 3-dot action menu from overlapping the status badge in chatroom cards.

### Current Behavior
- Status badge is at top-right of header row (line 340)
- Action menu is absolutely positioned at `top-2 right-2` (line 371)
- Both occupy the same visual space, causing overlap

### Required Changes

**File:** `apps/webapp/src/modules/chatroom/components/ChatroomSelector.tsx`

**Option A (Recommended):** Integrate menu into header row
1. Move the action menu inside the header flex container
2. Use flexbox to place status badge and menu button side-by-side
3. Remove absolute positioning from menu

**Alternative Option B:** Adjust absolute positioning
1. Change menu position to be below the status badge
2. E.g., `top-3` with sufficient padding on status badge

### Success Criteria
- [ ] Status badge is fully visible
- [ ] Action menu button does not overlap any content
- [ ] Both elements are accessible and clickable

---

## Phase 3: Fix Tables/Markdown Horizontal Scroll

### Objective
Prevent tables and code blocks from causing horizontal scroll in the message feed.

### Current Behavior
- Message content has `max-w-none` allowing unlimited width
- No overflow handling on tables/pre blocks
- Wide content causes horizontal scroll on the entire feed

### Required Changes

**File:** `apps/webapp/src/modules/chatroom/components/MessageFeed.tsx`

1. Add `overflow-x-auto` to the prose table wrapper (line 158)
   - Add: `prose-table:overflow-x-auto prose-table:block`
2. Add overflow handling for pre blocks
   - Add: `prose-pre:overflow-x-auto`
3. Consider adding `overflow-x-hidden` to the feed container (line 268)

### Success Criteria
- [ ] Tables with wide content scroll horizontally within their container
- [ ] Code blocks with long lines scroll horizontally
- [ ] Main feed does not have horizontal scroll
- [ ] Content is still readable and usable

---

## Phase 4: Replace Emoji Circles with Square Indicators

### Objective
Replace emoji circles (🟢🔵🟡) with square indicators per theme.md design conventions.

### Current Behavior
- `getTaskStatusBadge()` returns emoji labels (lines 61-97):
  - `'🟢 pending'`
  - `'🔵 in progress'`
  - `'🟡 queued'`
  - `'✅ done'`
  - `'❌ cancelled'`
  - `'📋 backlog'`

### Required Changes

**File:** `apps/webapp/src/modules/chatroom/components/MessageFeed.tsx`

1. Replace emoji labels with text-only labels:
   - `'🟢 pending'` → `'pending'` (color already indicates status)
   - `'🔵 in progress'` → `'in progress'`
   - `'🟡 queued'` → `'queued'`
   - `'✅ done'` → `'done'`
   - `'❌ cancelled'` → `'cancelled'`
   - `'📋 backlog'` → `'backlog'`

2. Or use square symbol: `■` if visual indicator is desired

### Success Criteria
- [ ] No emoji circles in task status badges
- [ ] Status is still clearly indicated by color
- [ ] Follows theme.md convention: "Don't use circles (use squares)"

---

## Phase Dependencies

```
Phase 1 ──┐
Phase 2 ──┼── (All independent, can be done in any order)
Phase 3 ──┤
Phase 4 ──┘
```

All phases are independent and can be implemented in any order. However, we'll proceed sequentially for easier review.

---

## Verification Checklist

After all phases complete:

- [ ] Loading chatroom cards are immediately clickable
- [ ] Menu button and status badge do not overlap
- [ ] Wide tables scroll within their container
- [ ] Pre/code blocks handle overflow properly
- [ ] No emoji circles in task status badges
- [ ] All changes follow theme.md design conventions
- [ ] TypeScript compiles without errors
- [ ] All existing tests pass
