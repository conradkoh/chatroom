# Pending Frontend-Only Backlog Items

## Status Summary

| Item | Status | Notes |
|------|--------|-------|
| #3: UI indicator for active agent | ✅ Already implemented | Blue indicator, pulse animation |
| #4: Message layout change | ⏳ Needs user input | Unclear original intent |
| #8: Move WorkingIndicator sticky | ✅ Implemented & pushed | Commit: 7825a20 |
| #10: Agent sidebar sort order | ⏳ Needs user input | Unclear original intent |
| #16: Pointer events bug | ✅ Already fixed | modal prop + version override |
| #17: Sticky user message | ⏳ Needs user input | Multiple design decisions needed |

---

## Items Needing User Input

### 1. Item #4: Message Layout Change
**Backlog ID:** `md70yj6dtkwh511k3ff21w2gd17zdcch`
**Truncated title:** "UX: IN the top right of each change message, we..."

**Current state:** 
- Message header: badges on left, sender→target on right
- Footer: status badge on left, timestamp on right

**Questions:**
- What element should be added/moved to the "top right of each change message"?
- Should the timestamp move from bottom-right to top-right?
- Is this about adding a new action button?

---

### 2. Item #10: Agent Sidebar Sort Order
**Backlog ID:** `md7cv6vkm2ecychrq0w5dgzj9x7zhmkt`
**Truncated title:** "In the agent sidebar, let's change the sort ord..."

**Current state:**
- Agents sorted as: Active (first) → Ready (collapsed) → Offline (collapsed)

**Questions:**
- What sort order change is needed?
- Should agents be sorted alphabetically within each category?
- Or should the category order change?

---

### 3. Item #17: Sticky User Message
**Backlog ID:** `md70jc7enw88rdz54q4ve7dayn7zja42`
**Truncated title:** "UX: Make last user message sticky to the top so..."

**Current state:**
- Messages scroll in chronological order
- User's original request can scroll out of view

**Questions:**
- Should we show the LAST user message or the ORIGIN message of the current task?
- Should it be collapsible to save space?
- Should the sticky message also appear in the normal feed (duplicate) or only at top?

---

## CLI Issues - FINDINGS

### Issue 1: Title Truncation - ROOT CAUSE FOUND

**Location:** `packages/cli/src/commands/backlog.ts` line 147

```typescript
console.log(
  `#${i + 1} [${statusEmoji} ${task.status.toUpperCase()}] ${truncate(task.content, 50)}`
);
```

**Problem:** The `truncate()` function limits content to **50 characters**, which is too short for meaningful task descriptions.

**Fix options:**
1. Increase truncation limit (e.g., 100-150 characters)
2. Add a `--full` flag to show complete content
3. Display content on multiple lines

**Truncate function (lines 318-320):**
```typescript
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
```

---

### Issue 2: Missing Backlog Tasks - ROOT CAUSE FOUND

**Location:** `packages/cli/src/commands/backlog.ts` line 73

```typescript
const statusFilter = options.status || 'active';
```

**Problem:** The default status filter is `'active'`, which only shows:
- pending
- in_progress  
- queued
- backlog

**Tasks marked as `completed` or `cancelled` are hidden by default!**

**Workaround:** Use `--status=all` or `--status=completed` to see all tasks:
```bash
chatroom backlog list <chatroomId> --role=builder --status=all
```

---

## Recommended Fixes

### For Truncation:
1. Change line 147 from `truncate(task.content, 50)` to `truncate(task.content, 100)`
2. OR add `--full` option that sets maxLength to infinity

### For Missing Tasks:
This is actually working as designed - completed tasks are hidden from active view.
Consider adding a note in the CLI help text that explains the default filter.
