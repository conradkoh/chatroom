# Plan 012: Implementation Phases

## Phase Breakdown

### Phase 1: Backend Prompt Infrastructure
**Goal:** Create the backend infrastructure for serving init prompts

**Changes:**
- Create `services/backend/convex/prompts/init/` directory
- Migrate `base.ts`, `wait-for-task.ts`, `task-started.ts`, `roles.ts` from webapp
- Create `getInitPrompt` query in `services/backend/convex/prompts/generator.ts`
- Update `generator.ts` to compose full init prompt

**Success Criteria:**
- [ ] `getInitPrompt` query returns complete agent prompt
- [ ] All init sections included (header, workflow, wait-for-task, etc.)
- [ ] TypeCheck passes
- [ ] Tests pass

---

### Phase 2: CLI Integration
**Goal:** CLI fetches init prompt from backend

**Changes:**
- CLI calls `getInitPrompt` when agent joins chatroom
- Display init prompt before first `wait-for-task`
- Keep existing prompt display for role guidance

**Success Criteria:**
- [ ] CLI displays full init prompt from backend
- [ ] Fallback to local prompts if API fails
- [ ] TypeCheck passes
- [ ] Tests pass

---

### Phase 3: Webapp Cleanup
**Goal:** Remove duplicate prompt code from webapp

**Changes:**
- Remove `apps/webapp/src/modules/chatroom/prompts/init/` directory
- Update any webapp components that referenced init prompts
- Keep only display-related prompt code in webapp

**Success Criteria:**
- [ ] No prompt generation in webapp
- [ ] Webapp still displays prompts correctly (via backend API)
- [ ] TypeCheck passes
- [ ] Tests pass

---

## Phase Dependencies

```
Phase 1 (Backend Infrastructure)
    ↓
Phase 2 (CLI Integration)
    ↓
Phase 3 (Webapp Cleanup)
```

All phases are sequential - each depends on the previous.

## Rollback Strategy

- **Phase 1 failure:** Remove new backend code, no user impact
- **Phase 2 failure:** CLI falls back to local prompts
- **Phase 3 failure:** Don't remove webapp code until Phase 2 is stable

## Current Status

- [x] Phase 1: Backend Prompt Infrastructure
- [x] Phase 2: CLI Integration
- [x] Phase 3: Webapp Cleanup (Modified - see below)

### Phase 3 Note

The webapp's `generateAgentPrompt` is used purely for UI display (showing prompts to users in the dashboard). Since:
1. The CLI now correctly fetches prompts from the backend
2. Webapp prompts are only for display purposes
3. Migrating webapp to use backend queries would require passing session context to UI components

**Decision:** Keep webapp prompts for now. They serve a different purpose (user-facing display) than CLI prompts (agent initialization). Can be unified in a future iteration if needed.
