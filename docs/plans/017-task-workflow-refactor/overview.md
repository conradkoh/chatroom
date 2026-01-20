# Plan 017: Task Workflow Refactor

## Summary

Refactored the task system to use an `origin`-based workflow model where each task type (backlog vs chat) has its own state machine. This replaces the confusing nested `backlog.status` field with a cleaner, more explicit system.

## Goals

1. **Clear origin tracking** - Every task explicitly knows where it came from (backlog or chat)
2. **Origin-specific workflows** - Backlog tasks have user review step, chat tasks complete directly
3. **Simplified status model** - Single `status` field determines lifecycle stage
4. **Backward compatibility** - Existing tasks continue to work during migration period

## Non-Goals

- Removing legacy `backlog` field immediately (requires migration)
- Changing the message attachment UX
- Modifying the task queue promotion logic

## Key Changes

### Before

- Tasks had optional `backlog` field with nested `status` property
- Multiple overlapping status fields (`status`, `backlog.status`)
- Unclear which status to check for different workflows

### After

- Tasks have `origin` field (`'backlog'` | `'chat'`)
- Single `status` field follows origin-specific workflow
- Clear state machines defined in `taskWorkflows.ts`

## Workflow Definitions

### Backlog-Origin Tasks

```
backlog → queued → pending → in_progress → pending_user_review → completed/closed
                                             ↑                      |
                                             └──────────────────────┘
                                              (send back for rework)
```

### Chat-Origin Tasks

```
queued → pending → in_progress → completed
```
