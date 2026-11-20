# Database Cleanup Policies

This document describes the automated TTL-based cleanup crons that prevent unbounded growth of database tables.

## Overview

All cleanup functions run as Convex `internalMutation` cron jobs. They process records in batches to stay within Convex mutation time/write limits. Functions that may have large backlogs use **self-rescheduling** — if a batch is fully consumed, the function schedules another immediate run via `ctx.scheduler.runAfter(0, ...)` to continue processing without waiting for the next cron interval.

## Cleanup Schedule

| Table                                   | Cleanup Strategy              | TTL / Condition                                                                    | Batch Size                | Schedule     | File                       | Notes                                                                                                                           |
| --------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------- | ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `chatroom_machineCommandInbox`          | Age-based / lease recovery    | Command deadline                                                                   | 2,000                     | Every 15 min | `machineCommandCleanup.ts` | Recovers expired claims every minute                                                                                            |
| `chatroom_commandOutput`                | Age-based (terminal runs)     | 7 days                                                                             | 500 chunks (50 runs)      | Hourly       | `storageCleanup.ts`        | Deletes output chunks for completed/failed/stopped runs                                                                         |
| `chatroom_commandRuns`                  | Age-based (terminal status)   | 30 days                                                                            | 500                       | Daily        | `storageCleanup.ts`        | Also deletes remaining output chunks                                                                                            |
| `chatroom_workspaceCommitDetail`        | Age-based                     | 30 days                                                                            | 500                       | Daily        | `storageCleanup.ts`        |                                                                                                                                 |
| `chatroom_workspaceFullDiff`            | Age-based                     | 24 hours                                                                           | 200                       | Hourly       | `storageCleanup.ts`        | Part of cached content cleanup                                                                                                  |
| `chatroom_workspaceFileContent`         | Age-based                     | 24 hours                                                                           | 200                       | Hourly       | `storageCleanup.ts`        | Part of cached content cleanup                                                                                                  |
| `chatroom_workspaceDiffRequests`        | Age-based                     | 24 hours                                                                           | 200                       | Hourly       | `storageCleanup.ts`        | Part of cached content cleanup                                                                                                  |
| `chatroom_workspaceFileContentRequests` | Age-based                     | 24 hours                                                                           | 200                       | Hourly       | `storageCleanup.ts`        | Part of cached content cleanup                                                                                                  |
| `chatroom_workspaceFileTree`            | Stale scannedAt               | 30 days                                                                            | 500                       | Daily        | `chatroomCleanup.ts`       | Self-reschedules if batch full                                                                                                  |
| `chatroom_read_cursors`                 | Orphaned (chatroom deleted)   | —                                                                                  | 500 scan / 300 delete cap | Daily        | `chatroomCleanup.ts`       | Delete-capped to prevent infinite loops                                                                                         |
| `chatroom_machines`                     | Inactive (lastSeenAt)         | 90 days                                                                            | 50                        | Daily        | `chatroomCleanup.ts`       | Starts a shared machine deletion (tombstone + scheduled purge of every `MACHINE_SCOPED_TABLES` table); workspaces soft-detached |
| `chatroom_machineDeletions`             | Completed tombstone retention | 7 days after `updatedAt` (`MACHINE_DELETION_RETENTION_MS`); failed tombstones kept | 100                       | Every 5 min  | `machineDeletion.ts`       | Sweep also restarts dead purge chains                                                                                           |
| `chatroom_participants`                 | Orphaned (chatroom deleted)   | —                                                                                  | 500 scan / 300 delete cap | Daily        | `chatroomCleanup.ts`       | Delete-capped to prevent infinite loops                                                                                         |
| `cliSessions`                           | Inactive + stale              | 30d (inactive) / 90d (stale)                                                       | 500                       | Daily        | `chatroomCleanup.ts`       | Two passes with dedup Set to prevent double-delete                                                                              |
| `cliAuthRequests`                       | Terminal status age           | 7 days                                                                             | 500                       | Daily        | `chatroomCleanup.ts`       | Targets expired, denied, approved requests                                                                                      |
| `chatroom_tasks`                        | Terminal status age           | 60 days                                                                            | 500                       | Daily        | `chatroomCleanup.ts`       | Uses completedAt with \_creationTime fallback                                                                                   |
| `chatroom_fileAttachments`              | Age-based (unbound)           | `pending_upload` 15 min / `uploaded` 60 min                                        | 100                       | Every 15 min | `fileAttachments.ts`       | Self-reschedules when a batch is full                                                                                           |

## Self-Rescheduling Pattern

For tables that may accumulate large backlogs, cleanup functions check whether the number of deleted records equals the batch size. If so, more records likely remain and the function schedules an immediate follow-up run:

```ts
if (deleted === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupFunctionName);
}
```

This ensures eventual convergence without overloading a single mutation. Functions using this pattern:

- `chatroomCleanup.cleanupWorkspaceFileTree` (batch 500)
- `chatroomCleanup.cleanupMachines` (batch 50, reschedules if more machines remain)
- `chatroomCleanup.cleanupCliSessions` (batch 500)
- `chatroomCleanup.cleanupCliAuthRequests` (batch 500)
- `chatroomCleanup.cleanupCompletedTasks` (batch 500)
- `fileAttachments.expireStaleUploads` (batch 100)

### File attachment upload expiry

Unbound `chatroom_fileAttachments` rows are removed by
`fileAttachments.expireStaleUploads`: `pending_upload` rows expire 15 minutes
after creation (no blob, no usage change) and `uploaded` rows expire 60 minutes
after upload (blob deleted, usage decremented). `attached` rows belong to a
delivered handoff and are never expired by this job.

The upload HTTP action stores the blob before binding it to the row. If the
process crashes between `ctx.storage.store` and `completeUpload`, one orphaned
blob can remain. This residual risk is accepted; no `_storage` sweep exists yet.

### Delete-Capped Orphan Detection

Orphan-detection cleanups (`cleanupReadCursors`, `cleanupParticipants`) use a different strategy to avoid infinite reschedule loops when most records are valid:

1. Scan up to 500 records ordered by `_creationTime`
2. Delete orphans up to a cap of 300 per mutation
3. Only reschedule if the delete cap was hit (meaning more orphans likely exist)
4. If no orphans found (or fewer than cap), stop — no reschedule

This prevents the pathological case where the cron infinitely reschedules to re-scan the same valid records.

## Machine Deletion

Deleting a machine — by a user through `machines.deleteMachine` or by the 90-day
inactive cleanup — always goes through the shared `startMachineDeletion` use case
in `services/backend/src/domain/usecase/machine/delete-machine.ts`.

1. **Tombstone first.** In one transaction the use case writes a
   `chatroom_machineDeletions` row (`status: 'purging'`) and deletes the
   `chatroom_machines` row together with its status, liveness, capabilities and
   available-models projections. Deleting the machine row revokes daemon authority:
   every daemon mutation authorizes through `requireMachineOwner` → `checkAccess`,
   which reads that row. `machines.register` refuses to create a machine while a
   `purging` tombstone exists.
2. **Budgeted, resumable purge.** The remaining machine data is purged by
   `machineDeletion.purgeBatch`, which walks `MACHINE_SCOPED_TABLES` in
   `services/backend/src/domain/usecase/machine/machine-scoped-tables.ts` in
   budgeted slices and reschedules itself until a full pass returns no rows. An
   empty verification pass marks the tombstone `completed`.
   `machineDeletion.sweepMachineDeletions` (every 5 minutes) restarts purge chains
   that died and prunes completed tombstones after 7 days.
3. **The registry is the contract.** `MACHINE_SCOPED_TABLES` is the authoritative
   list of what a machine deletion purges. A new table with a top-level `machineId`
   field must be registered there or listed in `MACHINE_SCOPED_EXEMPTIONS` with a
   reason; `src/domain/usecase/machine/machine-scoped-tables.spec.ts` fails when it
   is neither.
4. **What survives.** Workspaces are soft-detached (`removedAt` set, primary
   workspace pointer cleared) rather than deleted, so chatroom history keeps its
   workspace references. Chatrooms, messages and participants are preserved.
   Orphan capabilities projections (a capabilities row with no machine) are still
   cleaned inline by the 90-day cleanup.

The 90-day cleanup hands each stale machine to `startMachineDeletion` with
`initiatedBy: 'system'`, `requireOffline: false` and `inlineBudget: 0`, so only the
tombstone and authority revocation run inline and the purge is always scheduled.
User-initiated deletes run the first purge slice inline within
`MACHINE_PURGE_BUDGET` and require the machine to be offline.

Behaviour change from the previous inline cascade: the 90-day path used to
hard-delete workspaces and cover roughly 30 of the ~60 machine-keyed tables, listed
by hand and already stale. It now soft-detaches workspaces and covers every table
in `MACHINE_SCOPED_TABLES`.

Machines are still processed 50 per run by `cleanupMachines`, and the job
reschedules itself when a full batch was returned. The purge itself is not inline:
each machine schedules its own `machineDeletion.purgeBatch` chain.

## Source Files

- `services/backend/convex/machineCommandCleanup.ts` — Machine command inbox cleanup and lease recovery
- `services/backend/convex/storageCleanup.ts` — Command output, runs, commit details, cached content
- `services/backend/convex/chatroomCleanup.ts` — File trees, cursors, machines, participants, sessions, auth requests, tasks
- `services/backend/convex/fileAttachments.ts` — File attachment upload expiry
- `services/backend/convex/crons.ts` — Cron job registration
