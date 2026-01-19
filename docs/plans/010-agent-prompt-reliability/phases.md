# Plan 010: Agent Prompt Reliability - Phases

## Phase Breakdown

### Phase 1: Audit and Document Current State
**Goal:** Understand the current prompt system and identify specific issues.

**Tasks:**
1. Audit frontend init prompts for `wait-for-task` instructions
2. Audit backend role prompts for `wait-for-task` instructions
3. Document discrepancies between frontend and backend
4. Identify specific issues with reviewer role prompts
5. Test `getLatestForRole` query for reviewer role edge cases

**Deliverables:**
- List of identified issues
- Root cause analysis for each backlog item

**Success Criteria:**
- [x] All prompt sources audited
- [x] Issues documented with specific line references
- [x] Test cases identified for validation

**Status:** ✅ COMPLETED - See `audit-findings.md`

---

### Phase 2: Strengthen `wait-for-task` Instructions
**Goal:** Ensure agents always restart `wait-for-task` after unexpected termination.

**Changes:**
1. Backend `generator.ts`:
   - Add explicit "immediately restart" language
   - Include in every role's command section

2. Frontend `init/wait-for-task.ts`:
   - Verify unexpected termination section exists
   - Strengthen language if needed

3. Frontend `init/base.ts`:
   - Verify "Handle interrupts" note includes restart instruction

**Success Criteria:**
- [x] Backend and frontend have consistent `wait-for-task` instructions (already consistent)
- [x] All roles receive the same restart guidance (already consistent)
- [x] Tests pass

**Status:** ⏭️ SKIPPED - Audit found no changes needed

---

### Phase 3: Fix Reviewer Role Issues
**Goal:** Ensure reviewer has correct workflow and doesn't receive wrong messages.

**Changes:**
1. Backend `generator.ts`:
   - Verify `getReviewerWorkflow` explicitly says NOT to run `task-started`
   - Add bold/emphasized text for this instruction

2. Frontend `init/roles.ts`:
   - Verify `getReviewerGuidance` has same instruction
   - Cross-check wording for consistency

3. If needed, `messages.ts`:
   - Review `getLatestForRole` for reviewer-specific edge cases
   - Ensure handoffs are correctly routed

**Success Criteria:**
- [x] Reviewer prompts explicitly state NOT to run `task-started`
- [x] Reviewer only receives messages targeted at them (verified in audit)
- [x] Message routing tests pass

**Status:** ✅ COMPLETED - Minor wording fix applied

---

### Phase 4: Consistency Verification
**Goal:** Ensure frontend and backend prompts are consistent.

**Tasks:**
1. Create a cross-reference table of key instructions
2. Verify wording is consistent (or intentionally different with reason)
3. Update snapshot tests if needed

**Success Criteria:**
- [x] All key instructions are consistent across frontend/backend
- [x] Snapshot tests updated and passing
- [x] Manual verification of agent behavior

**Status:** ✅ COMPLETED - Combined with Phase 3

---

## Phase Dependencies

```
Phase 1 (Audit) ─→ Phase 2 (wait-for-task) ─┬─→ Phase 4 (Verification)
                                            │
                 ─→ Phase 3 (Reviewer Fix) ─┘
```

Phase 1 must complete first to identify issues. Phases 2 and 3 can be done in parallel after Phase 1. Phase 4 depends on both 2 and 3.

---

## Implementation Order

1. **Phase 1** - Start with audit to understand current state
2. **Phase 2** - Fix `wait-for-task` instructions
3. **Phase 3** - Fix reviewer role issues
4. **Phase 4** - Final verification

Each phase should be reviewed and committed separately.
