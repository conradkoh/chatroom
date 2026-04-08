# Database Cleanup Policies

This document describes the automated TTL-based cleanup crons that prevent unbounded growth of database tables.

## Overview

All cleanup functions run as Convex `internalMutation` cron jobs. They process records in batches to stay within Convex mutation time/write limits. Functions that may have large backlogs use **self-rescheduling** — if a batch is fully consumed, the function schedules another immediate run via `ctx.scheduler.runAfter(0, ...)` to continue processing without waiting for the next cron interval.

## Cleanup Schedule

| Table | Cleanup Strategy | TTL / Condition | Batch Size | Schedule | File | Notes |
|---|---|---|---|---|---|---|
| `chatroom_eventStream` | Age-based | 24 hours | 4,000 | Every 15 min | `eventCleanup.ts` | Self-reschedules if batch full |
| `chatroom_commandOutput` | Age-based (terminal runs) | 7 days | 500 chunks (50 runs) | Hourly | `storageCleanup.ts` | Deletes output chunks for completed/failed/stopped runs |
| `chatroom_commandRuns` | Age-based (terminal status) | 30 days | 500 | Daily | `storageCleanup.ts` | Also deletes remaining output chunks |
| `chatroom_workspaceCommitDetail` | Age-based | 30 days | 500 | Daily | `storageCleanup.ts` | |
| `chatroom_workspaceFullDiff` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceFileContent` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceDiffRequests` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceFileContentRequests` | Age-based | 24 hours | 200 | Hourly | `storageCleanup.ts` | Part of cached content cleanup |
| `chatroom_workspaceFileTree` | Stale scannedAt | 30 days | 500 | Daily | `chatroomCleanup.ts` | Self-reschedules if batch full |
| `chatroom_read_cursors` | Orphaned (chatroom deleted) | — | 500 | Daily | `chatroomCleanup.ts` | Checks if referenced chatroom exists |
| `chatroom_machines` | Inactive (lastSeenAt) | 90 days | 200 | Daily | `chatroomCleanup.ts` | Also deletes related `machineLiveness` and `machineStatus` rows |
| `chatroom_participants` | Orphaned (chatroom deleted) | — | 500 | Daily | `chatroomCleanup.ts` | Checks if referenced chatroom exists |
| `cliSessions` | Inactive + stale | 30d (inactive) / 90d (stale) | 500 | Daily | `chatroomCleanup.ts` | Two passes: inactive sessions, then stale by lastUsedAt |
| `cliAuthRequests` | Terminal status age | 7 days | 500 | Daily | `chatroomCleanup.ts` | Targets expired, denied, approved requests |
| `chatroom_tasks` | Terminal status age | 60 days | 500 | Daily | `chatroomCleanup.ts` | Targets completed/closed tasks; falls back to _creationTime if completedAt unset |

## Self-Rescheduling Pattern

For tables that may accumulate large backlogs, cleanup functions check whether the number of deleted records equals the batch size. If so, more records likely remain and the function schedules an immediate follow-up run:

```ts
if (deleted === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.chatroomCleanup.cleanupFunctionName);
}
```

This ensures eventual convergence without overloading a single mutation. Functions using this pattern:

- `eventCleanup.cleanupOldEvents` (batch 4,000)
- `chatroomCleanup.cleanupWorkspaceFileTree` (batch 500)
- `chatroomCleanup.cleanupMachines` (batch 200)
- `chatroomCleanup.cleanupCliSessions` (batch 500)
- `chatroomCleanup.cleanupCliAuthRequests` (batch 500)
- `chatroomCleanup.cleanupCompletedTasks` (batch 500)

Orphan-detection cleanups (`cleanupReadCursors`, `cleanupParticipants`) reschedule based on whether a full batch was **scanned** (not deleted), since only a subset of scanned records may be orphaned.

## Source Files

- `services/backend/convex/eventCleanup.ts` — Event stream cleanup
- `services/backend/convex/storageCleanup.ts` — Command output, runs, commit details, cached content
- `services/backend/convex/chatroomCleanup.ts` — File trees, cursors, machines, participants, sessions, auth requests, tasks
- `services/backend/convex/crons.ts` — Cron job registration
