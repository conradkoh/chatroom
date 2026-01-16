# Plan 004: API Naming Cleanup

## Summary

Rename and reorganize the backend message API methods and corresponding CLI commands to have clearer, more self-explanatory names. The current `send` and `sendHandoff` methods are confusingly named - it's not immediately clear what each does or when to use which.

## Goals

1. **Clarity**: Method names should clearly indicate their purpose and side effects
2. **Discoverability**: Developers should be able to understand the API from names alone
3. **Backward Compatibility**: Keep old methods/commands as deprecated aliases
4. **Consistency**: Naming should follow a consistent pattern across CLI and backend

## Non-Goals

- Changing the underlying functionality of any method
- Removing deprecated methods immediately (will be removed in a future version)
- Modifying the data model or schema

## Current State Analysis

### Backend Methods (services/backend/convex/messages.ts)

| Current Name | Purpose | Side Effects |
|--------------|---------|--------------|
| `send` | Send a message to the chatroom | Creates task for user messages and agent handoffs |
| `sendHandoff` | Complete task, send handoff message, update status | Completes in_progress tasks, sends message, creates task for target, updates participant status |

### CLI Commands (packages/cli/src/commands/)

| Current Command | Backend Method | Purpose |
|-----------------|----------------|---------|
| `chatroom send` | `messages.send` | Send a message as any role |
| `chatroom task-complete` | `messages.sendHandoff` | Complete a task and hand off to next role |

## Problem Analysis

1. **`send` is overloaded** - Does different things based on sender role and message type
2. **`sendHandoff` name is unclear** - Doesn't convey that it completes tasks and transitions state
3. **CLI `send` vs `task-complete`** - Relationship to backend methods isn't obvious

## Proposed Naming

### Backend Methods

| New Name | Replaces | Purpose |
|----------|----------|---------|
| `postMessage` | `send` | Post a message to the chatroom (generic messaging) |
| `completeAndHandoff` | `sendHandoff` | Complete current work and hand off to next agent |

### CLI Commands

| New Command | Replaces | Backend Method | Purpose |
|-------------|----------|----------------|---------|
| `chatroom message` | `chatroom send` | `postMessage` | Send/post a message |
| `chatroom handoff` | `chatroom task-complete` | `completeAndHandoff` | Complete task and hand off |

### Alternative Names Considered

**For `sendHandoff`:**
- `finishAndDelegate` - Clear but long
- `completeTask` - Conflicts with existing `tasks.completeTask`
- `handoffTask` - Implies task only, not message
- `completeAndHandoff` ✅ - Clear about both actions

**For `send`:**
- `postMessage` ✅ - Standard terminology
- `broadcast` - Implies multiple recipients
- `chat` - Too informal
- `say` - Too informal

**For CLI:**
- `chatroom message` ✅ - Noun-based, clear
- `chatroom msg` - Too abbreviated
- `chatroom post` - Less clear than "message"
- `chatroom handoff` ✅ - Clear about the action
- `chatroom delegate` - Less familiar terminology
- `chatroom finish` - Doesn't convey the handoff aspect
