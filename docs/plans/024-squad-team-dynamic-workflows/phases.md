# 024 - Squad Team with Dynamic Workflows: Implementation Phases

## Phase Breakdown

### Phase 1: Squad Team Configuration

**Goal**: Define the squad team with planner/builder/reviewer roles and basic routing.

**Tasks**:

1. Create `services/backend/prompts/teams/squad/config.ts` with team definition
2. Create `services/backend/prompts/base/cli/roles/planner.ts` with planner role prompt
3. Add `planner` role to hierarchy in `services/backend/convex/lib/hierarchy.ts`
4. Register squad team in the team configuration index
5. Update chatroom creation to support squad team selection

**Files**:

- `services/backend/prompts/teams/squad/config.ts` (new)
- `services/backend/prompts/base/cli/roles/planner.ts` (new)
- `services/backend/prompts/teams/index.ts` (modify)
- `services/backend/convex/lib/hierarchy.ts` (modify)

**Success Criteria**:

- Squad team can be created via web UI
- Planner receives user messages as entry point
- Basic planner → builder → reviewer → planner workflow works
- Planner can hand off to user

---

### Phase 2: Squad Workflow Logic

**Goal**: Implement squad-specific workflow and handoff rules.

**Tasks**:

1. Create `services/backend/prompts/teams/squad/workflow.ts` with workflow guidance
2. Update prompt generator to support squad team workflow
3. Define handoff rules: planner is the only role that can hand off to user
4. Builder and reviewer hand off to planner (not directly to user)
5. Add squad-specific classification handling (planner classifies, others use --no-classify)

**Files**:

- `services/backend/prompts/teams/squad/workflow.ts` (new)
- `services/backend/prompts/generator.ts` (modify)
- `services/backend/convex/messages.ts` (modify - handoff validation)

**Success Criteria**:

- Full squad workflow (planner → builder → reviewer → planner → user) works end-to-end
- Builder cannot hand off directly to user in squad team
- Reviewer cannot hand off directly to user in squad team
- Planner is the only role that classifies user messages

---

### Phase 3: Dynamic Team Availability

**Goal**: Inject team availability into system prompts and adapt workflows.

**Tasks**:

1. Create query to get active/waiting participants for a chatroom
2. Pass team availability context to prompt generator
3. Update planner prompt to include "Available team members: [...]"
4. Generate workflow-variant-specific guidance based on availability
5. Adapt handoff validation to only allow handoffs to available roles (+ planner always available)

**Files**:

- `services/backend/convex/participants.ts` (modify - add availability query)
- `services/backend/prompts/generator.ts` (modify - accept availability)
- `services/backend/prompts/workflows/resolver.ts` (new)
- `services/backend/prompts/workflows/types.ts` (new)
- `services/backend/convex/messages.ts` (modify - dynamic handoff targets)

**Success Criteria**:

- Planner prompt includes current team availability
- When builder is unavailable, planner/reviewer absorb implementation
- When reviewer is unavailable, planner absorbs review
- Planner solo mode works (all responsibilities)
- Handoff targets dynamically reflect available roles

---

### Phase 4: Backlog Clearing Mode

**Goal**: Enable autonomous backlog processing mode.

**Tasks**:

1. Add `workflowMode` field to chatroom schema
2. Create mutation to toggle backlog clearing mode
3. Update planner prompt to include backlog clearing instructions when active
4. Add auto-pickup logic: after completing a backlog item, planner picks next
5. Allow user messages to interrupt backlog clearing (user message takes priority)
6. Add UI toggle for backlog clearing mode

**Files**:

- `services/backend/convex/schema.ts` (modify - add workflowMode)
- `services/backend/convex/chatrooms.ts` (modify - add toggle mutation)
- `services/backend/prompts/generator.ts` (modify - backlog mode prompt)
- `apps/webapp/` (modify - add UI toggle)

**Success Criteria**:

- User can activate backlog clearing mode via UI
- Planner automatically picks next backlog item after completing current
- User messages interrupt backlog clearing
- Backlog items are marked for user review after completion
- Mode can be deactivated via UI

---

### Phase 5: Testing & Documentation

**Goal**: Comprehensive testing and documentation.

**Tasks**:

1. Add integration tests for squad team workflow (similar to `team-pair-workflow.spec.ts`)
2. Add integration tests for dynamic availability scenarios
3. Add snapshot tests for planner system prompt (similar to wait-for-task-prompt.spec.ts)
4. Update README with squad team documentation
5. Update AGENTS.md if needed

**Files**:

- `services/backend/tests/integration/team-squad-workflow.spec.ts` (new)
- `services/backend/tests/integration/cli/squad-prompt.spec.ts` (new)
- `README.md` (modify)

**Success Criteria**:

- All workflow variants tested (full, no-reviewer, no-builder, solo)
- Prompt snapshots verified for each variant
- Documentation updated

## Recommended Approach

Start with Phase 1 and 2 together (static squad definition + workflow), as they form the minimum viable squad team. Phase 3 (dynamic availability) builds on the static foundation. Phase 4 (backlog clearing) is independent and can be done in parallel with Phase 3 or after.

```
Phase 1 + 2 → Phase 3 → Phase 4 → Phase 5
   (static)     (dynamic)  (backlog)  (testing)
```
