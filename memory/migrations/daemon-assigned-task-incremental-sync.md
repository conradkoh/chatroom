---
type: decision-log
title: Daemon assigned-task incremental sync migration
description: Replace the daemon's reactive full assigned-task list with a compact per-machine cursor and debounced task deltas.
tags: [daemon, task-monitor, convex, bandwidth, incremental-sync, migration]
status: active
---

# Daemon assigned-task incremental sync migration

## Context

The daemon task monitor currently maintains a WebSocket subscription to
`machines.listMachineAssignedTaskSnapshots`. That query collects every active
assigned-task snapshot for a machine and returns the full list whenever any
snapshot row changes. This makes otherwise small task or participant updates
produce a response proportional to the machine's entire active task set.

The repository also has
`machines.subscribeAssignedTaskSignalsSince`, but the current daemon uses its
payload only as a notification. The task monitor then looks up the changed row
from the full-list subscription. The full-list subscription is therefore the
primary bandwidth optimization target.

## Primary goals

1. Keep one initial full hydrate for daemon startup and recovery.
2. Remove the long-lived full-list task snapshot subscription.
3. Notify the daemon through a compact per-machine cursor.
4. Debounce bursts of cursor changes for approximately one second.
5. Fetch and apply only task changes after the daemon's last successfully
   processed revision.
6. Preserve reliable handling of upserts, task status changes, participant
   action changes, configuration changes, and task removals.
7. Keep pure presence heartbeats on the separate presence path rather than
   turning them into task-state updates.

## Schema step completed

Added `chatroom_machineTaskUpdateCursors` to the Convex schema. It is one row
per machine:

| Field            | Meaning                                              |
| ---------------- | ---------------------------------------------------- |
| `machineId`      | Registered daemon machine identity                   |
| `latestRevision` | Monotonically increasing latest task-update revision |
| `updatedAt`      | Timestamp of the latest cursor update                |

The cursor is only a lightweight WebSocket wake-up signal. It is not the
durable delta source and must not be treated as sufficient history by itself.

## Target design

```text
task/config/participant mutation
        │
        ├── update assigned-task projection
        ├── record upsert/delete change with revision
        └── update machine cursor atomically

daemon subscribes to compact cursor
        │
        ├── debounce for ~1 second
        ├── fetch changes after lastProcessedRevision
        ├── apply changes locally
        └── advance cursor only after successful processing
```

## Required follow-up work

### Backend

- Add a durable task-change table or equivalent revisioned/tombstoned
  projection. It must represent both `upsert` and `delete` operations.
- Use a monotonic numeric revision. Do not use an opaque message ID or a
  composite state key whose ordering can move backwards when participant
  action strings change.
- Update the assigned-task projection write paths so the change record and
  machine cursor are written atomically with the projection update.
- Add an indexed query for changes after `(machineId, afterRevision)` with
  pagination and a compact response.
- Add a cursor query for the daemon's per-machine subscription.
- Keep authorization checks consistent with the existing machine snapshot
  queries.

### Daemon

- Retain one-shot startup hydrate from
  `machines.listMachineAssignedTaskSnapshots`.
- Subscribe to the compact machine cursor instead of the full snapshot list.
- Debounce cursor notifications and coalesce concurrent fetches into one
  delta request.
- Apply upserts and deletes to the local working snapshot.
- Advance `lastProcessedRevision` only after the delta page has been applied;
  drain all pages before considering the cursor caught up.
- Retry failed delta fetches without losing the unprocessed revision range.
- Continue using the presence channel for `lastSeenAt` heartbeat updates.

### Validation

- Verify that one changed task does not send the full active-task list.
- Verify bursty changes are coalesced into one or a small number of delta
  fetches.
- Verify no changes are lost across daemon restart, reconnect, or a failed
  fetch.
- Verify task deletion/removal is reflected locally.
- Verify participant heartbeat-only changes do not enter the task-state delta
  stream.
- Add backend integration tests for revision exclusivity, pagination,
  upserts, deletes, and cursor authorization.
- Add daemon tests for debounce, retry, cursor advancement, and local merge.

## Current status

- [x] Add compact per-machine cursor table to the Convex schema.
- [x] Add durable task-change history/tombstones.
- [x] Add cursor update and delta query use cases.
- [x] Switch daemon task monitor away from the full-list subscription.
- [x] Add debounce and restart-safe delta processing.
- [ ] Remove obsolete full-list reactive wiring after rollout validation.

## Related code

- `services/backend/convex/schema.ts` — cursor and assigned-task projection
- `services/backend/convex/machines.ts` — current machine task queries
- `services/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-sync.ts` — projection writes
- `services/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-read.ts` — indexed reads
- `packages/cli/src/daemon/entry/task-monitor-runtime.ts` — current full-list subscription
- `packages/cli/src/daemon/infrastructure/convex/subscribers/assigned-task-signals.ts` — existing signal subscriber
