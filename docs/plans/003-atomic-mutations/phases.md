# Implementation Phases

## Phase 1: Backend - Create `sendHandoff` Mutation ✅ COMPLETED

### Objective
Create a single atomic mutation that handles the entire handoff flow.

### Changes

1. **Add `sendHandoff` mutation to `messages.ts`** ✅
   - Validate handoff is allowed (check classification rules)
   - Complete all in_progress tasks in the chatroom
   - Insert handoff message
   - Create task for target agent (if not user)
   - Update sender participant status to waiting
   - Promote next queued task if needed
   - Return comprehensive result

2. **Update CLI `task-complete.ts`** ✅
   - Replaced 3 mutation calls with single `sendHandoff` call
   - Classification validation moved to backend (throws error if not allowed)
   - CLI catches validation errors and shows helpful messages

3. **Update CLI API types** ✅
   - Added `sendHandoff` to `api.messages` in `api.ts`

### Success Criteria
- ✅ `task-complete` command works with single mutation
- ✅ All state changes happen atomically
- ✅ Error in any step rolls back entire operation

---

## Phase 2: Backend - Create `claimTask` Mutation

### Objective
Create a single atomic mutation for claiming a task when agent starts work.

### Changes

1. **Add `claimTask` mutation to `tasks.ts`**
   - Validate task is pending and available
   - Transition task to in_progress
   - Set assignedTo and startedAt
   - Claim associated message (if exists)
   - Update participant status to active
   - Return task and message data

2. **Update CLI `wait-for-message.ts`**
   - Replace `startTask` + `claimMessage` + `updateStatus` with single `claimTask`
   - Handle race condition response (task already claimed)

### Success Criteria
- Task claiming happens atomically
- Race conditions handled gracefully
- No orphaned states possible

---

## Phase 3: Cleanup and Testing

### Objective
Remove dead code and verify all flows work correctly.

### Changes

1. **Keep existing mutations for backward compatibility** (optional)
   - Mark as deprecated if kept
   - Or remove if no longer used

2. **Add comprehensive logging**
   - Log atomic operations for debugging

3. **Verify all CLI commands**
   - task-complete
   - wait-for-message
   - Ensure no orphaned state scenarios

### Success Criteria
- All CLI commands use atomic mutations
- No multiple mutation patterns remain
- System handles failures gracefully
