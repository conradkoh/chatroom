# Plan 006: Features System - Simplified Implementation Phases

## Phase Breakdown (Simplified)

| Phase | Scope | Files |
|-------|-------|-------|
| 1 | Backend: Schema + Mutations + Queries | `schema.ts`, `messages.ts` |
| 2 | CLI: Feature commands + task-started update | `feature.ts`, `task-started.ts`, `index.ts` |
| 3 | CLI: wait-for-task updates | `wait-for-task.ts` |
| 4 | Tests | `features.spec.ts` |

---

## Phase 1: Backend Changes

### Schema

Add to `chatroom_messages`:
- `featureTitle: v.optional(v.string())`
- `featureDescription: v.optional(v.string())`
- `featureTechSpecs: v.optional(v.string())`

### Mutations

Update `taskStarted` to accept and store feature metadata (all optional for backward compatibility).

### Queries

**New:** `listFeatures(sessionId, chatroomId, limit?)` - Returns new_feature messages with metadata
**New:** `inspectFeature(sessionId, chatroomId, messageId)` - Returns full feature + thread

### Success Criteria
- [ ] Schema updated
- [ ] taskStarted accepts feature fields
- [ ] Both queries work

---

## Phase 2: CLI Commands

### New Commands

```bash
# No --role needed for read-only queries
chatroom feature list <chatroomId> [--limit=<n>]
chatroom feature inspect <chatroomId> <messageId>
```

### Updated Command

```bash
# --role required (existing behavior)
# New required fields for new_feature classification
chatroom task-started <chatroomId> --role=<role> --classification=new_feature --title="..." --description="..." --tech-specs="..."
```

CLI validates: if classification=new_feature and any field missing, fail with helpful error.

### Success Criteria
- [ ] feature list/inspect work without --role
- [ ] task-started validates new_feature fields
- [ ] Helpful error messages

---

## Phase 3: wait-for-task Updates

Add to JSON output:

```typescript
instructions: {
  // existing fields...
  classificationCommands: {
    question: "chatroom task-started <id> --role=<role> --classification=question",
    new_feature: "chatroom task-started <id> --role=<role> --classification=new_feature --title=\"...\" --description=\"...\" --tech-specs=\"...\"",
    follow_up: "chatroom task-started <id> --role=<role> --classification=follow_up"
  },
  contextCommands: [  // only when question
    "chatroom feature list <chatroomId> --limit=5",
    "chatroom backlog list <chatroomId> --role=<role>"
  ]
}
```

### Success Criteria
- [ ] classificationCommands always included
- [ ] contextCommands included for question

---

## Phase 4: Tests

Add tests for:
- Feature metadata storage
- Feature list query
- Feature inspect query
- CLI validation

---

## Simplifications Made

1. **Removed --role from feature commands** - Read-only, no role needed
2. **Merged backend phases** - Schema/mutations/queries together
3. **Merged CLI phases** - Feature commands + task-started together
4. **Removed ContextCommand/ClassificationCommand interfaces** - Just strings
5. **Reduced from 6 phases to 4**

---

## Verification Checklist

- [ ] Backend stores feature metadata
- [ ] `chatroom feature list` works
- [ ] `chatroom feature inspect` works
- [ ] `chatroom task-started --classification=new_feature` requires fields
- [ ] wait-for-task shows command examples
- [ ] All tests pass
- [ ] CLI version bumped
