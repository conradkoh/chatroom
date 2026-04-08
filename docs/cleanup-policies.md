# Database Cleanup Policies

This document describes the automated TTL-based cleanup crons that prevent unbounded growth of database tables.

## Overview

All cleanup functions run as Convex `internalMutation` cron jobs. They process records in batches to stay within Convex mutation time/write limits. Functions that may have large backlogs use **self-rescheduling** — if a batch is fully consumed, the function schedules another immediate run via `ctx.scheduler.runAfter(0, ...)` to continue processing without waiting for the next cron interval.

## Cleanup Schedule

| Table | Cleanup Strategy | TTL / Condition | Batch Size | Schedule | File | Notes |
|---|---|---|---|---|---|---|
| `chatroom_eventStream` | Age-based | 24 hours | 2,000 | Every 15 min | `eventCleanup.ts` | Self-reschedules if batch full |
| `chatroom_commandOutput` | Age-based (terminal runs) | 7 days | 500 chunks (50 runs) | Hourly | `storageCleanup.ts` | Deletes output chunks for completed/failed/stopped runs |
| `chatroom_commandRuns` | Age-based (terminal status) | 30 days | 500 | Daily | `storageCleanup.ts` | Also deletes remaining output chunks |
| `chatroom_workspaceCommitDetail` | Age-based | 30 days | 500 | Daily | `storageCleanup.ts` | |
| `chatroom_workspaceFullDiff` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceFileContent` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceDiffRequests` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceFileContentRequests` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceFileTree` | Stale scannedAt | 30 days | 500 | Daily | `chatroomCleanup.ts` | Self-reschedules if batch full |
| `chatroom_read_cursors` | Orphaned (chatroom deleted) | — | 500 scan / 300 delete cap | Daily | `chatroomCleanup.ts` | Delete-capped to prevent infinite loops |
| `chatroom_machines` | Inactive (lastSeenAt) | 90 days | 50 | Daily | `chatroomCleanup.ts` | Full cascading delete of 16+ related tables |
| `chatroom_participants` | Orphaned (chatroom deleted) | — | 500 scan / 300 delete cap | Daily | `chatroomCleanup.ts` | Delete-capped to prevent infinite loops |
| `cliSessions` | Inactive + stale | 30d (inactive) / 90d (stale) | 500 | Daily | `chatroomCleanup.ts` | Two passes with dedup Set to prevent double-delete |
| `cliAuthRequests` | Terminal status age | 7 days | 500 | Daily | `chatroomCleanup.ts` | Targets expired, denied, approved requests |
| `chatroom_tasks` | Terminal status age | 60 days | 500 | Daily | `chatroomCleanup.ts` | Uses completedAt with _creationTime fallback |

## Self-Rescheduling Pattern

For tables that may accumulate large backlogs, cleanup functions check whether the number of deleted records equals the batch size. If so, more records likely remain and the function schedules an immediate follow-up run:

```ts
if (deleted === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupFunctionName);
}
```

This ensures eventual convergence without overloading a single mutation. Functions using this pattern:

- `eventCleanup.cleanupOldEvents` (batch 2,000)
- `chatroomCleanup.cleanupWorkspaceFileTree` (batch 500)
- `chatroomCleanup.cleanupMachines` (batch 50, reschedules if more machines remain)
- `chatroomCleanup.cleanupCliSessions` (batch 500)
- `chatroomCleanup.cleanupCliAuthRequests` (batch 500)
- `chatroomCleanup.cleanupCompletedTasks` (batch 500)

### Delete-Capped Orphan Detection

Orphan-detection cleanups (`cleanupReadCursors`, `cleanupParticipants`) use a different strategy to avoid infinite reschedule loops when most records are valid:

1. Scan up to 500 records ordered by `_creationTime`
2. Delete orphans up to a cap of 300 per mutation
3. Only reschedule if the delete cap was hit (meaning more orphans likely exist)
4. If no orphans found (or fewer than cap), stop — no reschedule

This prevents the pathological case where the cron infinitely reschedules to re-scan the same valid records.

## Machine Cascading Delete

When a machine is deleted (90-day inactive), the cleanup removes ALL related rows across these tables:

| Table | Lookup Method |
|-------|--------------|
| `chatroom_machineLiveness` | Index: `by_machineId` |
| `chatroom_machineStatus` | Index: `by_machineId` |
| `chatroom_machineModelFilters` | Index: `by_machine_harness` |
| `chatroom_teamAgentConfigs` | Index: `by_machineId` |
| `chatroom_workspaces` | Index: `by_machine` |
| `chatroom_workspaceGitState` | Filter: `machineId` |
| `chatroom_workspaceFileTree` | Filter: `machineId` |
| `chatroom_workspaceFileContent` | Filter: `machineId` |
| `chatroom_workspaceFullDiff` | Filter: `machineId` |
| `chatroom_workspacePRDiffs` | Filter: `machineId` |
| `chatroom_workspaceDiffRequests` | Filter: `machineId` |
| `chatroom_workspaceFileContentRequests` | Filter: `machineId` |
| `chatroom_workspaceFileTreeRequests` | Filter: `machineId` |
| `chatroom_workspaceCommitDetail` | Filter: `machineId` |
| `chatroom_runnableCommands` | Filter: `machineId` |
| `chatroom_commandRuns` | Filter: `machineId` (+ output chunks) |

Due to the large number of related rows, machines are processed in small batches (50 per run).

## Source Files

- `services/backend/convex/eventCleanup.ts` — Event stream cleanup
- `services/backend/convex/storageCleanup.ts` — Command output, runs, commit details, cached content
- `services/backend/convex/chatroomCleanup.ts` — File trees, cursors, machines, participants, sessions, auth requests, tasks
- `services/backend/convex/crons.ts` — Cron job registration
