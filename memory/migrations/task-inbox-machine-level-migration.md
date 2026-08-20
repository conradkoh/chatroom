---
type: decision-log
title: Task inbox machine-level migration
description: Migration from chatroom-scoped task monitoring to a machine-scoped task-status signal inbox.
tags: [tasks, inbox, daemon, convex, migration]
status: in-progress
---

# Task inbox machine-level migration

## Context

The daemon is moving from the existing task monitor and local task snapshot flow to an inbox that receives task-status signals and hydrates full task records only when work changes. A machine-level inbox is preferred because subscribing to the full task list at machine scope would create too much bandwidth and update churn.

The inbox should therefore subscribe only to `chatroom_timelineTaskStatusSignals` routed to its machine, keep one cursor per machine, and fetch full task records imperatively for the signal range. The inbox is not wired into task delivery yet; this migration currently covers the signal feed and its supporting backend behavior.

## Decision

- Subscribe at machine scope using `targetMachineId` on task-status signals.
- Keep the existing chatroom-scoped signal index for webapp consumers; add a machine-scoped index for daemon consumers.
- Treat signals as historical routing events. Before delivering a hydrated task, re-check its current assignment so a task that moved after the signal is not sent to the wrong agent.
- Use an async iterator around the signal subscription. For each signal, hydrate all full task records since the stored cursor or service start, advance the cursor after successful processing, and resume listening.
- Keep native agent delivery primitives such as process management, task injection, coordination, ledgers, and mutexes. Only the task-discovery and task-monitoring path is being replaced.

## Current implementation

The machine-level inbox foundation is staged on branch `feat/task-inbox`:

- `packages/cli/src/daemon/infrastructure/inbox/task.ts` accepts a `machineId`, listens to the machine-scoped signal endpoint, hydrates task records, and exposes the async-iterator loop.
- `packages/cli/src/daemon/infrastructure/inbox/task.test.ts` covers the signal-to-hydration flow.
- `services/backend/convex/schema.ts` adds optional `targetMachineId` and `targetRole` fields plus the machine signal index.
- `services/backend/convex/messageList.ts` provides the machine-scoped signal subscription.
- `services/backend/convex/tasks.ts` provides machine-authorized range hydration with task-id deduplication.
- Task creation, reassignment, release-on-agent-exit, and in-progress recovery now emit routed status signals.

The earlier persistence refactor is intentionally stashed as `wip: inbox persistence refactor`. It will be restored after the inbox phase is committed and aligned with the machine-level cursor model.

The inbox phase has not been committed because the repository hook currently treats the intentionally unwired inbox module and one helper export as unused code. Resolving that hook decision is separate from this migration design.

## Progress tracker

### Inbox and backend signal feed

- [x] Create the initial task-status signal iterator.
- [x] Decide that the daemon inbox is machine-scoped rather than a full machine-level task-list subscription.
- [x] Add machine routing metadata to task-status signals.
- [x] Add the machine-scoped signal index and owner authorization.
- [x] Implement machine signal subscription with a signal cursor.
- [x] Implement imperative task hydration for a machine signal range.
- [x] Emit routed signals for task creation and direct assignment/reassignment paths.
- [ ] Commit the machine-level inbox phase after resolving the intentional dead-code hook failure.

### Daemon wiring

- [ ] Define the daemon inbox lifecycle and machine cursor startup policy.
- [ ] Subscribe the daemon to the machine-level inbox.
- [ ] For each new task, resolve the intended agent.
- [ ] Start the agent session when it is not running.
- [ ] Inject the task through the existing native delivery path.
- [ ] Make delivery idempotent across duplicate signals, retries, and daemon restarts.
- [ ] Add integration coverage for task arrival, reassignment, restart recovery, and concurrent signals.

### Persistence

- [ ] Restore the stashed inbox persistence refactor.
- [ ] Store state extensibly for multiple inboxes, with machine identity and a durable signal cursor.
- [ ] Decide whether startup should replay from the durable cursor, bootstrap active tasks, or combine both.
- [ ] Handle legacy signals that predate `targetMachineId`.
- [ ] Test cursor advancement, crash/retry behavior, and database initialization.

## Open decisions and risks

- Startup behavior must prevent stranded tasks while avoiding a large historical replay.
- Signals can be duplicated or arrive out of order; cursor advancement and delivery must tolerate both.
- Every status-changing assignment path must emit a machine-routed signal, including paths outside the currently covered use cases.
- Historical routing fields may no longer match the task's current assignment, so delivery must validate current ownership.
- Existing signal rows without a target machine need an explicit compatibility or bootstrap policy.

## Cleanup plan

After machine-level inbox delivery has parity and recovery coverage, remove the superseded discovery path:

- Remove the old assigned-task signal and presence subscribers from the daemon subscriber registry.
- Remove the task-monitor runtime, local task snapshot store, and snapshot-only reconciliation/nudge/revive logic that the inbox replaces.
- Remove chatroom-scoped daemon inbox endpoints and compatibility code once no consumers remain; retain the chatroom index if the webapp still uses it.
- Remove obsolete signal fields, indexes, tests, and fixtures only after confirming their consumers are gone.
- Update daemon architecture documentation and memory records, then delete or mark completed migration-only tracking notes.
