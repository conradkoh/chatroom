# Cleanup Tasks

This document tracks the cleanup work needed for the API naming changes.

## Completed Work

### CLI Commands Removed

| Command | Status | Reason |
|---------|--------|--------|
| `chatroom send` | ❌ Removed | Agents must always hand off |
| `chatroom send-message` | ❌ Removed | Agents must always hand off |

### CLI Commands Added/Updated

| Command | Status | Purpose |
|---------|--------|---------|
| `chatroom handoff` | ✅ Added | Complete task and hand off (preferred) |
| `chatroom task-complete` | @deprecated | Deprecated alias for `handoff` |

### Backend Methods

| Method | Status | Purpose |
|--------|--------|---------|
| `messages.handoff` | ✅ Added | Complete work and hand off (preferred) |
| `messages.sendHandoff` | @deprecated | Deprecated alias for `handoff` |
| `messages.send` | Kept | Used by WebUI for user messages |
| `messages.sendMessage` | Kept | Alias for `send`, used by WebUI |

### Files Removed

| File | Status |
|------|--------|
| `packages/cli/src/commands/send.ts` | ✅ Deleted |

### Prompts Updated

| Location | Status |
|----------|--------|
| `services/backend/convex/prompts/generator.ts` | ✅ Updated |
| `apps/webapp/src/modules/chatroom/prompts/init/base.ts` | ✅ Updated |
| `apps/webapp/src/modules/chatroom/prompts/init/wait-for-message.ts` | ✅ Updated |
| `packages/cli/src/commands/create.ts` | ✅ Updated |
| `README.md` (root) | ✅ Updated |
| `packages/cli/README.md` | ✅ Updated |

---

## Deprecated Items to Remove (Future Version)

These items should be removed in a future major version after adequate deprecation period.

### Backend Methods

| Method | Replacement | File | Status |
|--------|-------------|------|--------|
| `messages.sendHandoff` | `messages.handoff` | `services/backend/convex/messages.ts` | @deprecated |

### CLI Commands

| Command | Replacement | File | Status |
|---------|-------------|------|--------|
| `chatroom task-complete` | `chatroom handoff` | `packages/cli/src/index.ts` | @deprecated |

### CLI Implementation Files

| File | Action | Status |
|------|--------|--------|
| `packages/cli/src/commands/task-complete.ts` | Rename to `handoff.ts` after deprecation period | 📋 Planned |

---

## Migration Guide for Users

### For CLI Users

```bash
# Old (deprecated)
chatroom task-complete <chatroomId> --role=builder --message="Done" --next-role=reviewer

# New (recommended)
chatroom handoff <chatroomId> --role=builder --message="Done" --next-role=reviewer
```

### Asking Questions (changed pattern)

```bash
# Old approach (no longer supported - send without handoff)
chatroom send <chatroomId> --message="Can you clarify X?" --role=builder

# New approach (hand off to user with question)
chatroom handoff <chatroomId> --role=builder --message="Can you clarify X?" --next-role=user
```

### For API Users (Direct Backend Calls)

```typescript
// Old (deprecated)
await client.mutation(api.messages.sendHandoff, { ... });

// New (recommended)
await client.mutation(api.messages.handoff, { ... });
```

---

## Removal Timeline

| Version | Action |
|---------|--------|
| v1.0.18 | ✅ Removed `send`/`send-message` CLI commands |
| v1.0.18 | ✅ Added `handoff` CLI command |
| v1.0.18 | ✅ Added `handoff` backend mutation |
| v1.x.x | Show deprecation warnings when `task-complete` is used |
| v2.0.0 | Remove `task-complete` and `sendHandoff` |

---

## Testing Checklist

- [x] `chatroom handoff` works correctly
- [x] `chatroom task-complete` shows deprecation warning and works
- [x] Prompts use `handoff` command
- [x] READMEs updated
- [x] `send.ts` command file deleted
- [ ] Deploy backend with new `handoff` mutation
- [ ] Update CLI to use `api.messages.handoff` after backend deploy
