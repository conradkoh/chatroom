# Plan 009: Convex Query Optimization - Phases

## Phase Breakdown

### Phase 1: Enhanced Auth Helper
**Goal:** Make `requireChatroomAccess` return the chatroom object to eliminate duplicate fetches.

**Changes:**
1. Modify `requireChatroomAccess` in `lib/cliSessionAuth.ts` to return `Doc<'chatroom_rooms'>`
2. Update all call sites to use the returned chatroom instead of re-fetching

**Files Modified:**
- `services/backend/convex/lib/cliSessionAuth.ts`
- `services/backend/convex/messages.ts`
- `services/backend/convex/tasks.ts`
- `services/backend/convex/participants.ts`
- `services/backend/convex/chatrooms.ts`

**Success Criteria:**
- [ ] `requireChatroomAccess` returns chatroom object
- [ ] No function calls `ctx.db.get('chatroom_rooms')` after calling `requireChatroomAccess`
- [ ] All tests pass

---

### Phase 2: Atomic Queue Position Counter
**Goal:** Eliminate queue position race conditions using an atomic counter.

**Changes:**
1. Add `nextQueuePosition` field to schema
2. Update task creation in `messages.ts` to use atomic counter
3. Update task creation in `tasks.ts` to use atomic counter
4. Handle migration for existing chatrooms (read max position on first use)

**Files Modified:**
- `services/backend/convex/schema.ts`
- `services/backend/convex/messages.ts`
- `services/backend/convex/tasks.ts`

**Success Criteria:**
- [ ] Schema includes `nextQueuePosition` field
- [ ] Task creation uses atomic counter pattern
- [ ] Concurrent task creation test passes (no duplicate positions)
- [ ] All existing tests pass

---

### Phase 3: Handoff Optimization (Optional)
**Goal:** Further reduce operations in the handoff mutation.

**Changes:**
1. Combine participant status check into handoff flow
2. Consider batching task queries where possible

**Note:** This phase is optional and may be deferred based on performance gains from phases 1-2.

**Success Criteria:**
- [ ] Handoff operations reduced to ~10 or fewer
- [ ] No regressions in handoff functionality
- [ ] Performance improvement measurable

---

## Phase Dependencies

```
Phase 1 (Auth Helper) ─┬─→ Phase 2 (Atomic Counter)
                       │
                       └─→ Phase 3 (Handoff Optimization)
```

Phase 1 must be completed first as Phase 2 and 3 depend on the enhanced auth helper.

---

## Implementation Order

1. **Phase 1** - Start here. Refactors auth helper and updates all consumers.
2. **Phase 2** - Adds atomic counter for queue positions.
3. **Phase 3** - Optional optimization pass for handoff operations.

Each phase should be committed separately after passing review.
