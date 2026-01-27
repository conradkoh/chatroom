# CLI Positional to Named Parameters Refactoring

**Status:** 🟡 In Progress  
**Created:** 2026-01-26  
**Updated:** 2026-01-26  
**Strategy:** Incremental Migration (Test-Driven, One Command at a Time)  
**Estimated Effort:** 6-8 hours  

---

## Table of Contents

1. [Overview](#overview)
2. [Scope](#scope)
3. [Incremental Implementation Workflow](#incremental-implementation-workflow)
4. [Phase 1: chatroomId Parameter](#phase-1-chatroomid-parameter)
5. [Phase 2: artifactId Parameter](#phase-2-artifactid-parameter)
6. [Phase 3: Prompt & Documentation Updates](#phase-3-prompt--documentation-updates)
7. [Implementation Checklist](#implementation-checklist)
8. [Testing Strategy](#testing-strategy)
9. [Rollback Plan](#rollback-plan)

---

## Overview

### Goal
Convert all positional parameters in the CLI to named parameters for consistency, clarity, and maintainability.

### Why This Change?
1. **Consistency** - All parameters use the same named format
2. **Clarity** - No ambiguity about which value is which
3. **Order Independence** - Parameters can be specified in any order
4. **Self-Documenting** - Commands are easier to understand at a glance
5. **Future-Proof** - Easier to add new required parameters

### Migration Strategy
**Incremental Approach** - Convert one command at a time with test-driven workflow:
- ✅ Progressive validation - catch issues early
- ✅ Easier to debug - smaller changes
- ✅ Can pause/resume - clear checkpoints
- ✅ Lower risk - rollback is simpler
- ✅ Tests guide implementation

**Previous Strategy:** ~~Big Bang Migration~~ (Changed to Incremental for better safety and validation)

---

## Incremental Implementation Workflow

### Approach
Convert **one command at a time** using a test-driven workflow. This ensures each change is validated before moving to the next.

### Per-Command Workflow

For each command, follow these 5 steps:

#### 1. Update Integration Test
**File:** `services/backend/tests/integration/cli/<command>-prompt.spec.ts`

- Update test expectations to use new named parameter syntax
- Update expected prompt text to show `--chatroom-id` instead of `<chatroomId>`
- Commit: `test: update <command> test for named parameters`

**Example:**
```diff
- expect(prompt).toContain('chatroom wait-for-task <chatroomId>')
+ expect(prompt).toContain('chatroom wait-for-task --chatroom-id <chatroomId>')
```

#### 2. Run Tests (Expect Failure)
```bash
pnpm test --filter=@workspace/backend
```

- Tests should FAIL because CLI hasn't been updated yet
- Verify failure is due to CLI syntax mismatch
- This confirms tests are working correctly

#### 3. Update Prompts
**Files:** `services/backend/prompts/base/cli/<command>/`

- Update prompt templates to use new syntax
- Update command examples
- Update help text
- Commit: `refactor: update <command> prompts for named parameters`

#### 4. Update CLI Code
**File:** `packages/cli/src/index.ts`

- Remove `<chatroomId>` from `.command()` signature
- Add `.requiredOption('--chatroom-id <id>', 'Chatroom identifier')`
- Update action handler signature
- Commit: `refactor: convert <command> to use named --chatroom-id parameter`

**Pattern:**
```typescript
// Before
.command('wait-for-task <chatroomId>')
.action(async (chatroomId: string, options: {...}) => {

// After
.command('wait-for-task')
.requiredOption('--chatroom-id <id>', 'Chatroom identifier')
.action(async (options: { chatroomId: string; ... }) => {
```

#### 5. Test & Validate
```bash
# Run tests again (should pass now)
pnpm test --filter=@workspace/backend

# Type check
pnpm typecheck

# Manual CLI test
chatroom <command> --chatroom-id=<test-id> --role=builder
```

- All tests should pass
- Type checks should pass
- Manual test should work correctly
- If all good, move to next command

### Command Order

Process commands in this order (grouped by category for easier context switching):

**Core Commands (5):**
1. wait-for-task ← START HERE
2. task-started
3. task-complete
4. handoff
5. report-progress

**Context & Messages (2):**
6. context read
7. messages list

**Backlog Commands (6):**
8. backlog list
9. backlog add
10. backlog complete
11. backlog reopen
12. backlog patch-task
13. backlog reset-task

**Artifact Commands (3):**
14. artifact create
15. artifact view-many
16. artifact view (includes artifactId - Phase 2)

### Progress Tracking

Use checkboxes in the Implementation Checklist to track which commands are done.

### Benefits of This Approach

1. **Early Detection** - Catch issues immediately, one command at a time
2. **Incremental Validation** - Tests verify each change works
3. **Easy Pause/Resume** - Can stop at any command and pick up later
4. **Clear History** - Each command has its own set of commits
5. **Lower Risk** - If something breaks, only one command affected
6. **Guided Implementation** - Tests tell you what to change

---

## Scope

### Parameters to Convert
1. **`<chatroomId>`** - 16 commands affected
2. **`<artifactId>`** - 1 command affected (artifact view)

### Out of Scope
- No other positional parameters exist
- All other parameters already use named format (`--flag`)

---

## Phase 1: chatroomId Parameter

### Commands Affected (16 total)

#### Core Commands (5)
| Command | Current | New |
|---------|---------|-----|
| wait-for-task | `wait-for-task <chatroomId>` | `wait-for-task --chatroom-id <id>` |
| task-started | `task-started <chatroomId>` | `task-started --chatroom-id <id>` |
| task-complete | `task-complete <chatroomId>` | `task-complete --chatroom-id <id>` |
| handoff | `handoff <chatroomId>` | `handoff --chatroom-id <id>` |
| report-progress | `report-progress <chatroomId>` | `report-progress --chatroom-id <id>` |

#### Backlog Commands (6)
| Command | Current | New |
|---------|---------|-----|
| backlog list | `backlog list <chatroomId>` | `backlog list --chatroom-id <id>` |
| backlog add | `backlog add <chatroomId>` | `backlog add --chatroom-id <id>` |
| backlog complete | `backlog complete <chatroomId>` | `backlog complete --chatroom-id <id>` |
| backlog reopen | `backlog reopen <chatroomId>` | `backlog reopen --chatroom-id <id>` |
| backlog patch-task | `backlog patch-task <chatroomId>` | `backlog patch-task --chatroom-id <id>` |
| backlog reset-task | `backlog reset-task <chatroomId>` | `backlog reset-task --chatroom-id <id>` |

#### Messages Commands (1)
| Command | Current | New |
|---------|---------|-----|
| messages list | `messages list <chatroomId>` | `messages list --chatroom-id <id>` |

#### Context Commands (1)
| Command | Current | New |
|---------|---------|-----|
| context read | `context read <chatroomId>` | `context read --chatroom-id <id>` |

#### Artifact Commands (3)
| Command | Current | New |
|---------|---------|-----|
| artifact create | `artifact create <chatroomId>` | `artifact create --chatroom-id <id>` |
| artifact view | `artifact view <chatroomId> <artifactId>` | `artifact view --chatroom-id <id> --artifact-id <id>` |
| artifact view-many | `artifact view-many <chatroomId>` | `artifact view-many --chatroom-id <id>` |

### Code Changes Required

#### File: `packages/cli/src/index.ts`

For each command, apply this pattern:

**Before:**
```typescript
program
  .command('wait-for-task <chatroomId>')
  .description('Join a chatroom and wait for tasks')
  .requiredOption('--role <role>', 'Role to join as')
  .action(async (chatroomId: string, options: { role: string }) => {
    await maybeRequireAuth();
    await waitForTask(chatroomId, { role: options.role });
  });
```

**After:**
```typescript
program
  .command('wait-for-task')
  .description('Join a chatroom and wait for tasks')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--role <role>', 'Role to join as')
  .action(async (options: { chatroomId: string; role: string }) => {
    await maybeRequireAuth();
    await waitForTask(options.chatroomId, { role: options.role });
  });
```

**Key Changes:**
1. Remove `<chatroomId>` from `.command()` signature
2. Add `.requiredOption('--chatroom-id <id>', 'Chatroom identifier')`
3. Change action handler signature from `(chatroomId: string, options: {...})` to `(options: { chatroomId: string; ... })`
4. Update function call to use `options.chatroomId`

**Note:** Commander.js automatically converts `--chatroom-id` to `chatroomId` in the options object (camelCase conversion).

---

## Phase 2: artifactId Parameter

### Commands Affected (1 total)

| Command | Current | New |
|---------|---------|-----|
| artifact view | `artifact view <chatroomId> <artifactId>` | `artifact view --chatroom-id <id> --artifact-id <id>` |

### Code Changes Required

**Before:**
```typescript
artifactCommand
  .command('view <chatroomId> <artifactId>')
  .description('View a single artifact')
  .requiredOption('--role <role>', 'Your role')
  .action(async (chatroomId: string, artifactId: string, options: { role: string }) => {
    await maybeRequireAuth();
    await viewArtifact(chatroomId, { role: options.role, artifactId });
  });
```

**After:**
```typescript
artifactCommand
  .command('view')
  .description('View a single artifact')
  .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
  .requiredOption('--artifact-id <id>', 'Artifact identifier')
  .requiredOption('--role <role>', 'Your role')
  .action(async (options: { chatroomId: string; artifactId: string; role: string }) => {
    await maybeRequireAuth();
    await viewArtifact(options.chatroomId, { role: options.role, artifactId: options.artifactId });
  });
```

---

## Phase 3: Prompt & Documentation Updates

### Overview
After CLI code changes are complete, all prompts, documentation, and examples must be updated to reflect the new named parameter syntax.

### Files Requiring Updates

#### Agent Prompts (Critical)
These are embedded in the backend and shown to agents during runtime:

| Location | Files | Description |
|----------|-------|-------------|
| `services/backend/prompts/base/cli/` | All CLI-related prompts | Agent instructions for CLI usage |
| `services/backend/prompts/teams/pair/` | Team-specific workflows | Builder/reviewer workflows with CLI examples |
| `services/backend/prompts/teams/pair/roles/` | Role-specific guides | Individual role instructions |

**Search Pattern:**
```bash
grep -r "chatroom.*<chatroomId>" services/backend/prompts/
```

#### Documentation Files
| File | Type | Update Required |
|------|------|-----------------|
| `AGENTS.md` | Agent guide | ✅ Many CLI examples |
| `packages/cli/README.md` | CLI documentation | ✅ Usage examples |
| `packages/cli/example.md` | CLI examples | ✅ All examples |
| `docs/plans/*.md` | Project plans | ⚠️ Historical references (optional) |
| `todo.md` | Task tracking | ⚠️ May have CLI commands |

#### Test Files
| Location | Purpose | Update Required |
|----------|---------|-----------------|
| `services/backend/tests/integration/cli/` | CLI integration tests | ✅ Test invocations |
| Test specs with CLI examples | Validation | ✅ Expected output |

#### Error Messages & Help Text
Located in command files - already handled by Phase 1 & 2 code changes:
- `packages/cli/src/commands/*.ts` - Error message examples
- Commander.js auto-generates help text from `.requiredOption()`

### Update Strategy

#### 1. Search & Replace Patterns

**Core Commands (wait-for-task, task-started, handoff, etc.):**
```bash
# Before
chatroom wait-for-task <chatroomId>
chatroom wait-for-task jx750h696te75x67z5q6cbwkph7zvm2x

# After  
chatroom wait-for-task --chatroom-id <chatroomId>
chatroom wait-for-task --chatroom-id jx750h696te75x67z5q6cbwkph7zvm2x
```

**Backlog Commands:**
```bash
# Before
chatroom backlog list <chatroomId>

# After
chatroom backlog list --chatroom-id <chatroomId>
```

**Artifact View (Phase 2):**
```bash
# Before
chatroom artifact view <chatroomId> <artifactId>

# After
chatroom artifact view --chatroom-id <chatroomId> --artifact-id <artifactId>
```

#### 2. Automated Search Script

Create a script to find all occurrences:
```bash
#!/bin/bash
# Find all CLI usage examples

echo "=== Searching for positional chatroomId usage ==="
grep -r "chatroom [a-z-]* <chatroomId>" \
  --include="*.md" \
  --include="*.ts" \
  --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  .

echo ""
echo "=== Searching for positional artifactId usage ==="
grep -r "chatroom artifact view <chatroomId> <artifactId>" \
  --include="*.md" \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  .
```

#### 3. Verification Checklist

After updates, verify:
- [ ] **All agent prompts** use new syntax
- [ ] **AGENTS.md** has no old positional parameters
- [ ] **CLI examples** in packages/cli/ are updated
- [ ] **Test files** use new syntax
- [ ] **Error messages** show correct usage
- [ ] **grep search** returns no old syntax (except in this spec)

### Update Priority

**🔴 Critical (Must update immediately):**
1. Agent prompts in `services/backend/prompts/` - Agents use these at runtime
2. `AGENTS.md` - Primary agent reference
3. Test files - Must match new CLI behavior

**🟡 Important (Update before release):**
4. `packages/cli/README.md` and `example.md`
5. Error message examples in command files
6. `todo.md` and active project docs

**⚪ Optional (Nice to have):**
7. Historical docs in `docs/plans/` (old architecture docs)
8. Archived documentation

### Testing Prompt Updates

1. **Agent Prompts:**
   - Run wait-for-task and verify prompt shows correct syntax
   - Check that all command examples use `--chatroom-id`

2. **Documentation:**
   - Review AGENTS.md for consistency
   - Verify all examples are executable

3. **Tests:**
   - Run integration tests: `pnpm test`
   - Ensure test CLI invocations work

### Known Locations Summary

Based on codebase search, these files definitely need updates:
```
./AGENTS.md
./packages/cli/example.md
./packages/cli/src/utils/serialization/decode/encoding.md
./services/backend/prompts/base/cli/wait-for-task/reminder.ts
./services/backend/tests/integration/cli/wait-for-task-prompt.spec.ts
./docs/plans/004-api-naming-cleanup/cleanup.md
./docs/plans/006-context-commands/architecture.md
./docs/plans/006-context-commands/phases.md
./docs/plans/006-context-commands/prd.md
./docs/plans/020-task-lifecycle-reliability/architecture.md
./todo.md
```

---

## Implementation Checklist

### Phase 1: chatroomId Conversion

#### Code Changes
- [ ] **Core Commands** (5 commands)
  - [ ] wait-for-task
  - [ ] task-started
  - [ ] task-complete
  - [ ] handoff
  - [ ] report-progress

- [ ] **Backlog Commands** (6 commands)
  - [ ] backlog list
  - [ ] backlog add
  - [ ] backlog complete
  - [ ] backlog reopen
  - [ ] backlog patch-task
  - [ ] backlog reset-task

- [ ] **Messages Commands** (1 command)
  - [ ] messages list

- [ ] **Context Commands** (1 command)
  - [ ] context read

- [ ] **Artifact Commands** (3 commands)
  - [ ] artifact create
  - [ ] artifact view (chatroomId only - artifactId in Phase 2)
  - [ ] artifact view-many

#### Documentation Updates
- [ ] Search and update all CLI examples in codebase
- [ ] Update AGENTS.md (likely has many CLI examples)
- [ ] Update error messages with example commands
- [ ] Update any README files with CLI usage
- [ ] Update test files with CLI invocations

#### Testing
- [ ] Run type checks: `pnpm typecheck`
- [ ] Test each command manually
- [ ] Verify error messages are correct
- [ ] Test with environment variable: `CHATROOM_CONVEX_URL`

### Phase 2: artifactId Conversion

#### Code Changes
- [ ] Update artifact view command (complete conversion)

#### Documentation Updates
- [ ] Update artifact view examples
- [ ] Update related error messages

#### Testing
- [ ] Test artifact view command
- [ ] Verify all parameter combinations work

### Phase 3: Prompt & Documentation Updates

#### Agent Prompts (Critical)
- [ ] Update `services/backend/prompts/base/cli/` prompts
- [ ] Update `services/backend/prompts/teams/pair/` workflows
- [ ] Update role-specific prompts in `services/backend/prompts/teams/pair/roles/`
- [ ] Run automated search to find all occurrences
- [ ] Test agent prompts show correct syntax

#### Core Documentation
- [ ] **AGENTS.md** - Update all CLI examples
- [ ] **packages/cli/README.md** - Update usage examples
- [ ] **packages/cli/example.md** - Update all examples
- [ ] **packages/cli/src/utils/serialization/decode/encoding.md** - Update if needed

#### Test Files
- [ ] Update `services/backend/tests/integration/cli/` test invocations
- [ ] Run tests to verify: `pnpm test`
- [ ] Fix any failing tests

#### Project Documentation (Lower Priority)
- [ ] Review and update `todo.md` if it has CLI commands
- [ ] Update `docs/plans/` if they have active CLI examples
- [ ] Mark historical docs as outdated (optional)

#### Final Verification
- [ ] Run grep search: no positional `<chatroomId>` or `<artifactId>` found (except in this spec)
- [ ] Agent prompts verified in runtime
- [ ] All examples are executable

### Final Validation
- [ ] All type checks pass
- [ ] All tests pass (if applicable)
- [ ] All commands tested manually
- [ ] Git commit with clear message
- [ ] Update this spec with completion status

---

## Testing Strategy

### Manual Testing Checklist

For each converted command, test:

1. **Basic Usage**
   ```bash
   chatroom <command> --chatroom-id=<id> --role=builder [other-options]
   ```

2. **Missing Required Parameter**
   ```bash
   chatroom <command> --role=builder
   # Should show error: required option '--chatroom-id <id>' not specified
   ```

3. **Invalid Parameter Order**
   ```bash
   chatroom <command> --role=builder --chatroom-id=<id>
   # Should work (order independent)
   ```

4. **Help Text**
   ```bash
   chatroom <command> --help
   # Should show --chatroom-id in required options
   ```

### Automated Testing
- Run `pnpm typecheck` after all changes
- Ensure TypeScript types are correct
- No compilation errors

---

## Rollback Plan

### If Issues Arise

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   ```

2. **Partial Rollback**
   - Revert specific commands if needed
   - Keep working commands, fix broken ones

3. **Forward Fix**
   - If minor issues, fix forward instead of reverting
   - Commit fixes separately for clarity

### Risk Mitigation
- Keep changes in a single commit (or clearly related commits)
- Test thoroughly before committing
- Have this spec document to track progress

---

## Progress Tracking

### Status Legend
- 🟢 Complete
- 🟡 In Progress
- ⚪ Not Started
- ❌ Blocked

### Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| Spec Creation | 🟢 | This document |
| Phase 1: Code Changes | ⚪ | Not started |
| Phase 1: Testing | ⚪ | Not started |
| Phase 2: Code Changes | ⚪ | Not started |
| Phase 2: Testing | ⚪ | Not started |
| Phase 3: Agent Prompts | ⚪ | Not started |
| Phase 3: Documentation | ⚪ | Not started |
| Phase 3: Tests | ⚪ | Not started |
| Final Validation | ⚪ | Not started |

### Last Updated
**Date:** 2026-01-26  
**By:** builder  
**Status:** Spec updated with Phase 3 (Prompt & Documentation updates)

---

## Notes

### Commander.js Behavior
- `--chatroom-id` automatically becomes `chatroomId` in options (camelCase)
- `--artifact-id` automatically becomes `artifactId` in options (camelCase)
- Required options are enforced by Commander before action runs
- Order of options doesn't matter

### Breaking Change Communication
- This is a breaking change for all CLI users
- All existing scripts/automation will need updates
- Clear before/after examples should be provided
- Consider adding migration notes to release

---

## References

- Commander.js Documentation: https://github.com/tj/commander.js
- CLI Conventions: `docs/cli-conventions.md`
- Original Analysis: See conversation context in chatroom
