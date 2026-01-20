# Phases: Task Delivery Prompt Refactor

## Phase Breakdown

### Phase 1: Create Backend Infrastructure

Create the types, interfaces, and section framework without changing existing behavior.

**Tasks:**
1. Create `services/backend/convex/prompts/taskDelivery/types.ts` with interfaces
2. Create `services/backend/convex/prompts/taskDelivery/formatters.ts` with section formatting utilities
3. Create section files for each existing section:
   - `sections/messageReceived.ts`
   - `sections/chatroomState.ts`
   - `sections/nextSteps.ts`
   - `sections/roleGuidance.ts`
   - `sections/backlogCommands.ts`
   - `sections/jsonOutput.ts`
4. Create `sections/index.ts` with section registry
5. Create `taskDelivery/index.ts` with main composition function

**Success Criteria:**
- All new files compile without errors
- Types are exported correctly
- Unit tests pass for formatters (if added)

### Phase 2: Create Backend Query

Add the `getTaskDeliveryPrompt` query to the backend that constructs the complete prompt.

**Tasks:**
1. Add `getTaskDeliveryPrompt` query to `messages.ts`
2. Fetch all required data (chatroom, participants, rolePrompt, contextWindow)
3. Build `TaskDeliveryContext` from fetched data
4. Call composition function to generate prompt
5. Return `{ humanReadable, json }` response

**Success Criteria:**
- Query returns data matching current CLI output format
- Query handles all edge cases (missing message, missing context, etc.)
- TypeScript compiles without errors

### Phase 3: Update CLI to Use Backend

Update the CLI to call the new backend query instead of constructing prompts locally.

**Tasks:**
1. Import new query type definitions
2. Replace local prompt construction with backend call
3. Print returned `humanReadable` content
4. Print returned `json` data
5. Remove now-unused local helper functions
6. Update CLI API types if needed (`sync-cli-api.ts`)

**Success Criteria:**
- wait-for-task output is identical to before (character-for-character comparison)
- All existing functionality works
- No regression in task claiming or message handling

### Phase 4: Cleanup and Verification

Remove deprecated code and verify the migration is complete.

**Tasks:**
1. Remove unused imports and functions from CLI
2. Run full test suite
3. Manual testing of wait-for-task with different scenarios
4. Update documentation if needed

**Success Criteria:**
- All tests pass
- Manual testing confirms no regressions
- Code is clean with no unused functions

## Phase Dependencies

```
Phase 1 (Backend Infrastructure)
    ↓
Phase 2 (Backend Query)
    ↓
Phase 3 (Update CLI)
    ↓
Phase 4 (Cleanup)
```

Each phase depends on the previous phase. Phase 1 creates the foundation, Phase 2 builds the query, Phase 3 integrates it, and Phase 4 cleans up.

## Success Criteria Summary

| Phase | Key Verification |
|-------|------------------|
| Phase 1 | TypeScript compiles, files exist |
| Phase 2 | Query returns expected format |
| Phase 3 | CLI output matches exactly |
| Phase 4 | Tests pass, no unused code |
