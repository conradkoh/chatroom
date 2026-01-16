# Plan 004: API Naming Cleanup

## Summary

Rename and reorganize the backend message API methods and corresponding CLI commands to have clearer, more self-explanatory names. Removed the ability for agents to send messages without handing off - every agent action must result in a handoff to maintain workflow continuity.

## Goals

1. **Clarity**: Method names should clearly indicate their purpose and side effects
2. **Discoverability**: Developers should be able to understand the API from names alone
3. **Workflow Continuity**: Every agent action ends with a handoff to ensure tasks are always delegated
4. **Consistency**: Naming should follow a consistent pattern across CLI and backend

## Non-Goals

- Changing the underlying functionality of any method
- Removing deprecated methods immediately (will be removed in a future version)
- Modifying the data model or schema

## Completed Changes

### Backend Methods (services/backend/convex/messages.ts)

| Method | Status | Purpose |
|--------|--------|---------|
| `send` | Kept (for WebUI) | Send a message from users via WebUI |
| `sendMessage` | Kept (for WebUI) | Alias for `send` - used by WebUI |
| `sendHandoff` | @deprecated | Deprecated alias for `handoff` |
| `handoff` | ✅ New (preferred) | Complete work and hand off to next agent |

### CLI Commands

| Command | Status | Purpose |
|---------|--------|---------|
| `chatroom handoff` | ✅ New (preferred) | Complete task and hand off |
| `chatroom task-complete` | @deprecated | Deprecated alias for `handoff` |
| `chatroom send` | ❌ Removed | Agents must always hand off |
| `chatroom send-message` | ❌ Removed | Agents must always hand off |

## Design Decision: Removing Send Commands from CLI

We removed the ability for agents to send messages without handing off because:

1. **Workflow Continuity**: Every task should have a clear owner. If an agent sends a message without handing off, no one is assigned to continue the work.
2. **Simplified Mental Model**: Agents have one action: complete their work and hand off. Questions can be asked by handing off to the user.
3. **Reduced Complexity**: No need to track "who should respond" - the handoff target is always clear.

**How to ask questions as an agent:**
```bash
# Hand off to user with your question
chatroom handoff <id> --role=builder --message="Can you clarify X?" --next-role=user
```

**Note:** The backend `send`/`sendMessage` mutations are kept for the WebUI, where users submit messages.
