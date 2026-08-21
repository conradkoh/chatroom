---
type: decision-log
title: Task inbox machine-level migration
description: Migration from chatroom-scoped task monitoring to a machine-scoped task-status signal inbox. Implementation complete; post-migration cleanup in progress.
tags: [tasks, inbox, daemon, convex, migration]
status: active
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
- [x] Remove the task-monitor runtime, local task snapshot store, and snapshot-only reconciliation/nudge/revive logic that the inbox replaces. **→ Stages 2–3** (monitor runtime and snapshot store removed; delivery rehydrates from backend)
- [ ] Remove chatroom-scoped daemon inbox endpoints and compatibility code once no consumers remain; retain the chatroom index if the webapp still uses it. **→ Stage 4 (backend)**
- [ ] Remove obsolete signal fields, indexes, tests, and fixtures only after confirming their consumers are gone. **→ Stage 4 (backend)**
- [ ] Update daemon architecture documentation and memory records, then delete or mark completed migration-only tracking notes. **→ Stage 4 (docs)**

## Post-migration cleanup action plan

_Last updated: 2026-08-21 — four validation stages; Stage 4 includes backend cleanup plus daemon follow-ups; production breakage is accepted for Stages 3–4._

**Prerequisite:** Merge PR #1471 before cleanup commits. Separate commits by functionality within each stage and validate with a clean pushed tree.

| Stage | Scope                                                                                                      | Maps to                               | Risk        | Validation                      | Status     |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- | ------------------------------- | ---------- |
| **1** | Delete dead WS discovery chain, bridge/router, and monitor-only tests                                      | Cleanup item 1                        | Low         | Daemon starts and task delivers | ✅ Done    |
| **2** | Extract `task-delivery-processor.ts`; delete `task-monitor-runtime.ts`                                     | Cleanup item 2                        | Medium      | Full delivery matrix            | ✅ Done    |
| **3** | Remove global snapshot store; coordinator rehydrates from backend                                          | Cleanup item 2                        | Medium–high | Delivery, restart, idempotency  | ✅ Done    |
| **4** | Remove backend dead subscribe APIs; daemon naming/cooldown cleanup; turn-phase investigation; archive docs | Cleanup items 3–5 + post-Stage-3 debt | Medium      | Backend + daemon deploy smoke   | ⬜ Pending |

**End state:** Inbox-only daemon discovery; no task-monitor runtime or global snapshot store; no legacy subscribe APIs. Keep `listMachineAssignedTaskSnapshots`, machine signal hydration, and the `chatroom_timelineTaskStatusSignals` chatroom index.

### Stage 1 — Dead path removal

Completed in this commit batch: `a72b634ee`, `df318ffab`, and the monitor-only test cleanup commit.

Delete the assigned-task signal/presence subscribers and feeds, assigned-task bridge and inbound use cases, assigned-task monitor registry, and monitor-only tests. Edit `event-router.ts`, `default-router-deps.ts`, their tests, and subscriber/incremental-sync READMEs. Acceptance: `rg 'assigned-task-bridge|startAssignedTask|assigned-task\.signal'` returns zero in production CLI; CLI tests pass.

### Stage 2 — Delivery refactor

Completed in commit `c641d9a9d`; the monitor runtime was removed and delivery processing now lives in the native-delivery processor. The snapshot store remains for Stage 3.

Create `packages/cli/src/daemon/entry/native-delivery/task-delivery-processor.ts` by moving `processTasksUpdate` and renaming runtime/context types. Delete `task-monitor-runtime.ts` and monitor snapshot implementation/tests; update inbox runtime/delivery and affected daemon tests. Keep `task-monitor-logic.ts` for `NudgeCooldown`. Acceptance: inbox integration/runtime tests pass and `rg 'startTaskMonitorEffect|task-monitor-runtime'` returns zero.

### Stage 3 — Snapshot store removal

Completed in commits `3d2b3014e` and `54ee436b6`. Deleted `assigned-task-snapshot-store.ts` and its tests, removed `mergeSnapshotsIntoStore`, rehydrated delivery decisions from `listMachineAssignedTaskSnapshots`, and added a spawn-complete retry hook so pending native tasks inject immediately after `ensureRunning`.

### Stage 4 — Backend cleanup, daemon follow-ups, and docs

**Backend (existing scope):**

- Delete `subscribeAssignedTaskSignalsSince` / `subscribeAssignedTaskPresenceSince`, their use cases/helpers, and obsolete integration tests.
- Keep `listMachineAssignedTaskSnapshots`, `syncMachineAssignedTaskSnapshotsMutation`, machine signal subscription, signal table/chatroom index, snapshot contract, and range hydration.

**Daemon follow-ups (from post-Stage-3 tech debt):**

- [medium] **Turn-phase / claimTask investigation** — If task-received stuck recurs while agent output continues, investigate turn-phase updates in `session-event-forwarder` and `claimTask` path (not nudge/re-inject). Add regression test if root cause found.
- [low] **Rename `task-monitor-logic.ts` → `task-delivery-logic.ts`** — File name still references removed monitor runtime; update imports and test file names.
- [low] **Remove `NudgeCooldown` alias** — Migrate remaining test callers to `RecoveryCooldown` and delete the compatibility alias in `task-monitor-logic.ts` (or `task-delivery-logic.ts` after rename).

**Docs:**

- Check off cleanup items 2–5 in the Cleanup plan section above.
- Set this document `status: archived` when Stage 4 is complete.
- Update daemon architecture/README records.

**Acceptance:**

- `rg 'subscribeAssignedTaskSignalsSince|subscribeAssignedTaskPresenceSince'` returns zero in production code.
- Backend and CLI tests pass after Stage 4 backend work (daemon follow-ups may land as separate commits within Stage 4).

### Optional follow-ups (post-Stage 4)

- Rename assigned-task monitor contract to snapshot contract naming (if any references remain after backend cleanup).
- Add concurrent-signal integration coverage beyond existing inbox tests.
