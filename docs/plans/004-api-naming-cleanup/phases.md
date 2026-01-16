# Implementation Phases

## Phase 1: Backend - Add New Method Names

### Objective
Add new mutations with clearer names in the backend.

### Changes

1. **Extract shared logic into internal helper functions**
   - `_postMessageHandler` - core logic for posting messages
   - `_completeAndHandoffHandler` - core logic for completing and handing off

2. **Add new exported mutations**
   - `postMessage` - calls `_postMessageHandler`
   - `completeAndHandoff` - calls `_completeAndHandoffHandler`

3. **Update existing mutations to use shared logic**
   - `send` - calls `_postMessageHandler` (add deprecation JSDoc)
   - `sendHandoff` - calls `_completeAndHandoffHandler` (add deprecation JSDoc)

### Success Criteria
- Both old and new method names work identically
- Backend compiles without errors
- Existing tests pass

---

## Phase 2: CLI - Add New Command Names

### Objective
Add new CLI commands with clearer names.

### Changes

1. **Add new commands**
   - `chatroom message` - new command for sending messages
   - `chatroom handoff` - new command for completing and handing off

2. **Update existing commands**
   - `chatroom send` - add deprecation notice to description
   - `chatroom task-complete` - add deprecation notice to description

3. **Update API imports**
   - Run sync to get new backend methods
   - Update CLI to call new methods (with fallback)

### Success Criteria
- Both old and new commands work identically
- Deprecation notices shown in help text
- CLI builds and runs without errors

---

## Phase 3: Documentation Update

### Objective
Update all documentation to use new naming.

### Changes

1. **Update README files**
   - CLI README with new command examples
   - Main project README

2. **Update inline documentation**
   - JSDoc comments in backend
   - Help text in CLI commands

3. **Update agent prompts**
   - `services/backend/convex/prompts/` files
   - Any hardcoded CLI examples

### Success Criteria
- All docs reference new names
- Old names mentioned as deprecated
- No broken examples

---

## Phase Dependencies

```
Phase 1 ──► Phase 2 ──► Phase 3
Backend     CLI         Docs
```

All phases are sequential - backend changes must be deployed before CLI can use new methods.
