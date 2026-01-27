# Plan 020: Task Lifecycle Reliability

## Summary

This plan addresses the top 5 reliability issues in the task/agent lifecycle system. These issues share a common root cause: **inconsistent state management** when agents disconnect, timeout, or restart unexpectedly.

The key insight is that these bugs stem from three related problems:
1. **State transitions are not atomic** - Task status and agent status can become inconsistent
2. **Disconnection detection is reactive, not proactive** - We wait for timeouts instead of detecting early
3. **Attached tasks don't follow the parent task lifecycle** - They drift out of sync with the message flow

## Goals

1. Ensure task and participant states are always consistent
2. Implement proactive recovery when agents restart or reconnect
3. Fix attached backlog tasks to correctly transition through the workflow
4. Reduce stuck "Working" states and orphaned in_progress tasks
5. Improve visibility into agent/task health for debugging

## Non-Goals

1. Changes to the UI display (separate concern)
2. New features for task management (already covered by scoring feature)
3. Changes to the team/role configuration system
4. Performance optimizations (unless directly related to reliability)

## Issues Addressed

| Priority | Issue | Root Cause |
|----------|-------|------------|
| 90 | Bug: Attached tasks not marked pending_user_review | Condition only checks `backlog` status, missing queued/pending states |
| 88 | Agent not marked disconnected after timeout | No periodic cleanup of stale participants |
| 85 | Agent retry on wait-for-task restart | No state recovery when agent rejoins |
| 82 | Message/task lifecycle race condition | Task transitions before agent claims it |
| 80 | Retry function for "Working" state tasks | No mechanism to force-reset stuck tasks |

## Related Files

### Backend (services/backend/convex/)
- `participants.ts` - Agent join/leave and status management
- `tasks.ts` - Task creation, lifecycle, and queue management
- `messages.ts` - Message handling and attached task logic
- `lib/cliSessionAuth.ts` - Session validation helpers

### CLI (packages/cli/src/commands/)
- `wait-for-task.ts` - Agent polling and task claiming
- `task-started.ts` - Task acknowledgment
- `handoff.ts` - Task completion and handoff

### Webapp (apps/webapp/src/modules/chatroom/)
- `components/TaskQueue.tsx` - Task display and actions
- `components/TaskDetailModal.tsx` - Task detail actions
