# Cleanup Tasks

This document tracks the cleanup work needed for the API naming changes.

## Deprecated Items to Remove (Future Version)

These items should be removed in a future major version after adequate deprecation period.

### Backend Methods

| Method | Replacement | File | Status |
|--------|-------------|------|--------|
| `messages.send` | `messages.postMessage` | `services/backend/convex/messages.ts` | 🔄 To be deprecated |
| `messages.sendHandoff` | `messages.completeAndHandoff` | `services/backend/convex/messages.ts` | 🔄 To be deprecated |

### CLI Commands

| Command | Replacement | File | Status |
|---------|-------------|------|--------|
| `chatroom send` | `chatroom message` | `packages/cli/src/index.ts` | 🔄 To be deprecated |
| `chatroom task-complete` | `chatroom handoff` | `packages/cli/src/index.ts` | 🔄 To be deprecated |

### CLI Implementation Files

| File | Action | Status |
|------|--------|--------|
| `packages/cli/src/commands/send.ts` | Rename to `message.ts` after deprecation period | 📋 Planned |
| `packages/cli/src/commands/task-complete.ts` | Rename to `handoff.ts` after deprecation period | 📋 Planned |

---

## Code Locations to Update

### Backend Updates Required

1. **`services/backend/convex/messages.ts`**
   - [ ] Add `postMessage` mutation
   - [ ] Add `completeAndHandoff` mutation
   - [ ] Add `@deprecated` JSDoc to `send`
   - [ ] Add `@deprecated` JSDoc to `sendHandoff`

2. **`services/backend/convex/prompts/` (if any reference old names)**
   - [ ] Update any CLI command examples

### CLI Updates Required

1. **`packages/cli/src/index.ts`**
   - [ ] Add `message` command
   - [ ] Add `handoff` command  
   - [ ] Update `send` description with deprecation notice
   - [ ] Update `task-complete` description with deprecation notice

2. **`packages/cli/src/commands/`**
   - [ ] Create `message.ts` (or reuse `send.ts`)
   - [ ] Create `handoff.ts` (or reuse `task-complete.ts`)

3. **`packages/cli/src/api.ts`**
   - [ ] Will be auto-updated via sync script after backend changes

### Documentation Updates Required

1. **CLI README**
   - [ ] Update command examples
   - [ ] Add deprecation notices

2. **Agent Prompts/Instructions**
   - [ ] Update any hardcoded CLI examples in prompts
   - [ ] Grep for `chatroom send` and `chatroom task-complete`

---

## Migration Guide for Users

### For CLI Users

```bash
# Old (deprecated)
chatroom send <chatroomId> --message="Hello"
chatroom task-complete <chatroomId> --role=builder --message="Done" --next-role=reviewer

# New (recommended)
chatroom message <chatroomId> --message="Hello"
chatroom handoff <chatroomId> --role=builder --message="Done" --next-role=reviewer
```

### For API Users (Direct Backend Calls)

```typescript
// Old (deprecated)
await client.mutation(api.messages.send, { ... });
await client.mutation(api.messages.sendHandoff, { ... });

// New (recommended)
await client.mutation(api.messages.postMessage, { ... });
await client.mutation(api.messages.completeAndHandoff, { ... });
```

---

## Removal Timeline

| Version | Action |
|---------|--------|
| Current | Add new methods/commands alongside old ones |
| v1.x.x | Show deprecation warnings when old names are used |
| v2.0.0 | Remove deprecated methods/commands |

---

## Testing Checklist

Before marking cleanup as complete, verify:

- [ ] All new commands work identically to old commands
- [ ] Deprecation notices appear in `--help` output
- [ ] Backend methods return identical results
- [ ] Existing agent prompts work with new command names
- [ ] No broken references in documentation
- [ ] CLI sync script picks up new methods
