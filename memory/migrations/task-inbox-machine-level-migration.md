---
type: decision-log
title: Task inbox machine-level migration
description: Migration from chatroom-scoped task monitoring to a machine-scoped task-status signal inbox.
tags: [tasks, inbox, daemon, convex, migration]
status: complete
---

# Task inbox machine-level migration

## Context

The daemon is moving from the existing task monitor and local task snapshot flow to an inbox that receives task-status signals and hydrates full task records only when work changes. A machine-level inbox is preferred because subscribing to the full task list at machine scope would create too much bandwidth and update churn.

The inbox should therefore subscribe only to `chatroom_timelineTaskStatusSignals` routed to its machine, keep one cursor per machine, and fetch snapshot rows imperatively for the signal range. The daemon now wires this feed through the existing native delivery coordinator.

## Decision

- Subscribe at machine scope using `targetMachineId` on task-status signals.
- Keep the existing chatroom-scoped signal index for webapp consumers; add a machine-scoped index for daemon consumers.
- Treat signals as historical routing events. Before delivering a hydrated task, re-check its current assignment so a task that moved after the signal is not sent to the wrong agent.
- Use an async iterator around the signal subscription. For each signal, hydrate all full task records since the stored cursor or service start, advance the cursor after successful processing, and resume listening.
- Keep native agent delivery primitives such as process management, task injection, coordination, ledgers, and mutexes. Only the task-discovery and task-monitoring path is being replaced.

## Current implementation

The machine-level inbox foundation is staged on branch `feat/task-inbox`:

- `packages/cli/src/daemon/infrastructure/inbox/task.ts` accepts a `machineId`, listens to the machine-scoped signal endpoint, hydrates snapshot rows, and exposes the async-iterator loop.
- `packages/cli/src/daemon/infrastructure/inbox/task.test.ts` covers the signal-to-hydration flow.
- `services/backend/convex/schema.ts` adds optional `targetMachineId` and `targetRole` fields plus the machine signal index.
- `services/backend/convex/messageList.ts` provides the machine-scoped signal subscription.
- `services/backend/convex/tasks.ts` provides machine-authorized range hydration with ownership re-checks and snapshot projection rows.
- `packages/cli/src/daemon/entry/task-inbox-runtime.ts` owns the daemon inbox lifecycle, machine cursor startup policy, persistence, and native delivery wiring.
- Task creation, reassignment, release-on-agent-exit, and in-progress recovery now emit routed status signals.

The inbox persistence store is restored and uses `{ inboxType: 'task', scopeKey: machineId }` with a durable `afterSignalKey`; first startup bootstraps from daemon start time rather than replaying all history.

Assigned-task signal/presence subscribers are unregistered from `subscriber-registry.ts`; the task inbox is the sole discovery path. Integration tests cover reassignment ownership re-check, restart snapshot bootstrap, and cold-start agent revive via `ensureRunning`.

## Progress tracker

### Inbox and backend signal feed

- [x] Create the initial task-status signal iterator.
- [x] Decide that the daemon inbox is machine-scoped rather than a full machine-level task-list subscription.
- [x] Add machine routing metadata to task-status signals.
- [x] Add the machine-scoped signal index and owner authorization.
- [x] Implement machine signal subscription with a signal cursor.
- [x] Implement imperative task hydration for a machine signal range.
- [x] Emit routed signals for task creation and direct assignment/reassignment paths.
- [x] Commit the machine-level inbox phase; daemon wiring resolves the intentional dead-code path.

### Daemon wiring

- [x] Define the daemon inbox lifecycle and machine cursor startup policy.
- [x] Subscribe the daemon to the machine-level inbox.
- [x] For each new task, resolve the intended agent. Hydration returns the snapshot for `signal.targetRole` with a backend ownership re-check.
- [x] Start the agent session when it is not running. `runNativeInjectionEffect` calls `ensureRunning`.
- [x] Inject the task through the existing native delivery path via the coordinator.
- [x] Make delivery idempotent across duplicate signals, retries, and daemon restarts. Inbox loop auto-restart is added; ledger + reconcile + startup bootstrap cover restart recovery.
- [x] Add integration coverage for task arrival, reassignment, restart recovery, and concurrent signals. Covered in `task-inbox-delivery.integration.test.ts` (arrival, idempotency, reassignment skip, cold-start revive) and `task-inbox-runtime.test.ts` (restart bootstrap).

### Persistence

- [x] Restore the stashed inbox persistence refactor.
- [x] Store state extensibly for multiple inboxes, with machine identity and a durable signal cursor.
- [x] Decide startup should bootstrap from the daemon start time when no durable cursor exists.
- [x] Handle legacy signals that predate `targetMachineId`. They are excluded from the machine index; startup snapshot bootstrap via `listMachineAssignedTaskSnapshots` is the compatibility path.
- [x] Test cursor advancement, crash/retry behavior, and database initialization. Cursor non-advance on handler throw + DB reopen are tested; the full crash/retry loop is deferred.

## Open decisions and risks

- Startup behavior must prevent stranded tasks while avoiding a large historical replay.
- Signals can be duplicated or arrive out of order; cursor advancement and delivery must tolerate both.
- Every status-changing assignment path must emit a machine-routed signal, including paths outside the currently covered use cases.
- Historical routing fields may no longer match the task's current assignment, so delivery must validate current ownership.
- Existing signal rows without a target machine are excluded from the machine index; startup snapshot bootstrap is the compatibility policy.

## Cleanup plan

After machine-level inbox delivery has parity and recovery coverage, remove the superseded discovery path:

- [x] Remove the old assigned-task signal and presence subscribers from the daemon subscriber registry.
      Assigned-task signal/presence subscribers are unregistered from `subscriber-registry.ts`; task inbox is the sole discovery path.
- Remove the task-monitor runtime, local task snapshot store, and snapshot-only reconciliation/nudge/revive logic that the inbox replaces.
- Remove chatroom-scoped daemon inbox endpoints and compatibility code once no consumers remain; retain the chatroom index if the webapp still uses it.
- Remove obsolete signal fields, indexes, tests, and fixtures only after confirming their consumers are gone.
- Update daemon architecture documentation and memory records, then delete or mark completed migration-only tracking notes.
