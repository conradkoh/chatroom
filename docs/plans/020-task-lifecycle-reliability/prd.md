# PRD: Task Lifecycle Reliability

## Glossary

| Term | Definition |
|------|------------|
| **Active Task** | A task with status `pending` or `in_progress` |
| **Agent** | A CLI process running `wait-for-task` that can claim and process tasks |
| **Attached Task** | A backlog task linked to a message via `attachedTaskIds` |
| **Orphaned Task** | An `in_progress` task whose assigned agent is no longer active |
| **Participant** | A record in `chatroom_participants` representing an agent's presence |
| **Ready Agent** | An agent with status `waiting` or `idle` (not `active`) |
| **Stale Participant** | A participant whose timeout (`readyUntil` or `activeUntil`) has passed |

## User Stories

### Agent Reliability

**As an agent operator**, I want agents that restart unexpectedly to automatically recover their state, so that tasks don't get stuck.

**As an agent operator**, I want agents that timeout to be correctly marked as disconnected, so that the system can route work to other agents.

**As an agent operator**, I want stuck "Working" tasks to be retryable, so that I can recover from agent crashes without manual database fixes.

### Task Consistency

**As a user**, I want attached backlog tasks to move to pending_user_review when the agent completes work, regardless of their intermediate status (backlog, queued, pending).

**As a user**, I want the task queue to never have orphaned in_progress tasks, so that I can trust the task status display.

**As a user**, I want the system to automatically clean up stale agent states, so that the chatroom accurately reflects active participants.

### Debugging & Visibility

**As a developer**, I want to see detailed logs when state recovery occurs, so that I can debug issues.

**As a developer**, I want task state transitions to be auditable, so that I can trace what happened when something goes wrong.

## Acceptance Criteria

### Issue 1: Attached Tasks Not Marked Pending Review

- [ ] When agent hands off to user, attached tasks with `origin='backlog'` and transitional status transition to `pending_user_review`
- [ ] Transitional statuses (whitelist): `backlog`, `queued`, `pending`, `in_progress`
- [ ] Excluded statuses: `completed`, `closed`, `cancelled`, `archived`, `pending_user_review`
- [ ] Only backlog-origin tasks should be affected (not chat-origin tasks)
- [ ] Log each transition with chatroomId, taskId, from/to status

### Issue 2: Agent Not Marked Disconnected After Timeout

- [ ] Stale participants (past `readyUntil` or `activeUntil`) are detected and reset
- [ ] Add a scheduled function that runs periodically (every 1-5 minutes) to clean up stale participants
- [ ] When a stale active agent is detected, their `in_progress` tasks move back to `pending`
- [ ] Log when stale cleanup occurs with participant/task details

### Issue 3: Agent Retry on wait-for-task Restart

- [ ] When `participants.join` is called for an agent that was previously `active`:
  - Detect any `in_progress` tasks assigned to that role
  - Transition them back to `pending` (ready for re-claiming)
  - Add a system note in logs about the recovery
- [ ] The restarting agent should be able to pick up their own task again

### Issue 4: Message/Task Lifecycle Race Condition

- [ ] Investigate the exact race window in task claiming
- [ ] Ensure `startTask` is truly atomic - only one agent can claim a task
- [ ] Add idempotency check: if agent calls `task-started` but task is already `in_progress`, handle gracefully
- [ ] Log race condition occurrences for debugging

### Issue 5: Retry Function for "Working" State Tasks

- [ ] Add `resetStuckTask` mutation to force-reset an `in_progress` task to `pending`
- [ ] Clear `assignedTo` and `startedAt` when resetting
- [ ] Add audit log entry when manual reset occurs
- [ ] Expose via CLI: `chatroom backlog reset-task --task-id=<id>`
