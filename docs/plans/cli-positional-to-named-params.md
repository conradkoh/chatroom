# CLI Positional to Named Parameters Refactoring

**Status:** 🟡 In Progress  
**Created:** 2026-01-26  
**Strategy:** Big Bang Migration  
**Estimated Effort:** 5-7 hours  

---

## Table of Contents

1. [Overview](#overview)
2. [Scope](#scope)
3. [Phase 1: chatroomId Parameter](#phase-1-chatroomid-parameter)
4. [Phase 2: artifactId Parameter](#phase-2-artifactid-parameter)
5. [Implementation Checklist](#implementation-checklist)
6. [Testing Strategy](#testing-strategy)
7. [Rollback Plan](#rollback-plan)

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
**Big Bang Approach** - Convert all positional parameters in one release:
- ✅ Clean break, no confusion
- ✅ Easier to test
- ✅ Simpler migration story
- ✅ CLI is internal/development use

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
| Phase 1: Documentation | ⚪ | Not started |
| Phase 1: Testing | ⚪ | Not started |
| Phase 2: Code Changes | ⚪ | Not started |
| Phase 2: Testing | ⚪ | Not started |
| Final Validation | ⚪ | Not started |

### Last Updated
**Date:** 2026-01-26  
**By:** builder  
**Status:** Spec created, ready for implementation

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
