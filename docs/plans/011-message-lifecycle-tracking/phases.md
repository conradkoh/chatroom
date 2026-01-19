# Plan 011: Implementation Phases

## Phase Breakdown

### Phase 1: Schema Changes
**Goal:** Add lifecycle fields and index to messages table

**Changes:**
- Add `acknowledgedAt` field to `chatroom_messages` schema
- Add `completedAt` field to `chatroom_messages` schema
- Add `by_chatroom_senderRole_type_createdAt` index

**Success Criteria:**
- [ ] Schema updated with new fields
- [ ] Index created
- [ ] TypeCheck passes
- [ ] Existing tests pass (backward compatible)

---

### Phase 2: Update Mutations to Set acknowledgedAt
**Goal:** Mark messages as acknowledged when agent starts work

**Changes:**
- Update `startTask` mutation to set `acknowledgedAt` on task's source message
- Update `claimMessage` mutation to set `acknowledgedAt` (if not already set)

**Success Criteria:**
- [ ] `startTask` sets `acknowledgedAt` on source message
- [ ] `claimMessage` sets `acknowledgedAt`
- [ ] TypeCheck passes
- [ ] Tests pass

---

### Phase 3: Update Mutations to Set completedAt
**Goal:** Mark messages as completed when agent hands off

**Changes:**
- Update `handoff` mutation to set `completedAt` on relevant messages

**Success Criteria:**
- [ ] `handoff` sets `completedAt` on completed messages
- [ ] TypeCheck passes
- [ ] Tests pass

---

### Phase 4: Update Context Window Query
**Goal:** Filter context by `acknowledgedAt` instead of task status

**Changes:**
- Modify `getContextWindow` to filter user messages by `acknowledgedAt`
- Remove task table scan from context window logic
- Use new index for efficient origin message lookup

**Success Criteria:**
- [ ] Context window filters by `acknowledgedAt`
- [ ] No task table scan in `getContextWindow`
- [ ] TypeCheck passes
- [ ] Tests pass
- [ ] Queued messages excluded from context

---

## Phase Dependencies

```
Phase 1 (Schema) 
    ↓
Phase 2 (acknowledgedAt) ────┐
    ↓                        │
Phase 3 (completedAt)        │
    ↓                        │
Phase 4 (Context Window) ←───┘
```

- Phase 1 must complete first (schema required for all other phases)
- Phases 2 and 3 can theoretically be done in parallel, but sequential is cleaner
- Phase 4 depends on Phase 2 (needs `acknowledgedAt` to filter)

## Current Status

- [x] Phase 1: Schema Changes ✅
- [x] Phase 2: Update Mutations (acknowledgedAt) ✅
- [ ] Phase 3: Update Mutations (completedAt)
- [ ] Phase 4: Update Context Window Query
