# Feature: Repository Ledger

**Status:** Backend and daemon implemented; Repositories UI planned (package 3B)
**Last Updated:** 2026-11-20

---

## Status

Built:

- Backend: on-demand snapshot requests, chunked pages, expiry cleanup and bulk chatroom
  create in `services/backend/convex/repositoryLedger.ts` and
  `services/backend/convex/chatrooms.ts` (`chatrooms.createManyWithWorkspace`).
- Daemon: local ledger storage and on-demand snapshots in
  `packages/cli/src/daemon/domain/usecase/repository-ledger-service.ts`.

Not built yet:

- The Repositories section UI and its webapp hooks (package 3B).

## On-demand snapshot

The ledger is request/response and transient. It is never a durable, synced table.

- `repositoryLedger.request` is owner-only and requires the machine to be online
  (`MACHINE_OFFLINE` otherwise). It reuses a pending, unexpired request that satisfies the
  ask; otherwise it inserts a pending row and enqueues exactly one
  `daemon.reportRepositoryLedger` command.
- The request row expires 5 minutes after creation while pending, and 10 minutes after
  completion once terminal.
- `rescan: false` serves the stored daemon ledger without a scan. `rescan: true` refreshes
  the ledger first.
- `listEntries` pages the chunk rows. `get` returns the request row, including
  `invalidPathCount`, `repositoryCount`, `truncated`, and `roots`.
- `discard` is a best-effort early clear of a request and its chunks.
- The ledger is never uploaded autonomously. Nothing is pushed on boot, on rescan, or when
  project roots change.

## Caps

Values live in `services/backend/src/domain/entities/repository-ledger.ts`.

| Limit                | Value                       |
| -------------------- | --------------------------- |
| Entries per snapshot | 1000 (past it, `truncated`) |
| Entries per chunk    | 100                         |
| Chunks per snapshot  | 10                          |
| Path and root length | 1024                        |
| Name length          | 256                         |
| Branch length        | 256                         |
| Remote URL length    | 2048                        |
| Roots stored         | 20                          |
| Bulk create per call | 50                          |

Over-long entries are dropped, never truncated. Entries past the 1000-entry cap set
`truncated` and are not counted as invalid.

## Rejected-entry count

`invalidPathCount` on the request row means "entries the snapshot omits (invalid, over-long,
or duplicate paths)". It includes entries the daemon dropped before sending (over-cap or
duplicate paths) and entries the server omitted (invalid, over-long, or duplicate normalized
paths).

- A completed report with nothing omitted stores 0.
- A failed report stores no count.
- Entries past 1000 are not in the count; they set `truncated`.
- Dropping entries never fails the mutation. An all-dropped report completes with status
  `completed`, `repositoryCount: 0`, zero chunk rows, and the dropped count stored.

## Bulk create

Bulk create uses one creation path: each working directory goes through
`createChatroomWithWorkspace`
(`services/backend/src/domain/usecase/chatroom/create-chatroom-with-workspace.ts`), called
from `chatrooms.createManyWithWorkspace` (`services/backend/convex/chatrooms.ts`). The
single-repo action calls the same mutation with one element.

- The owner is checked once. The machine does not need to be online.
- The default team preset is `DEFAULT_TEAM_PRESET_ID`. No agent is started.
- A directory is skipped when the caller already has an active chatroom for the same machine
  and normalized path; it is reported as `already_has_chatroom`.
- Invalid directories are `failed` with `INVALID_WORKING_DIR`. Valid directories in the same
  call still create.
- More than 50 directories (`BULK_CREATE_MAX_REPOSITORIES`) fails the whole call with
  `BULK_CREATE_LIMIT_EXCEEDED`.
- The result is `{ results, created, skipped, failed }`. A repeated call creates nothing.

## Where the code lives

- `services/backend/convex/repositoryLedger.ts` — request lifecycle, chunked pages, report
  storage, discard and expiry cleanup.
- `services/backend/convex/chatrooms.ts` — `chatrooms.createManyWithWorkspace` entry point.
- `services/backend/src/domain/usecase/chatroom/create-chatroom-with-workspace.ts` — the only
  chatroom creation path.
- `services/backend/src/domain/usecase/chatroom/create-chatrooms-for-working-dirs.ts` — bulk
  create use case.
- `services/backend/src/domain/entities/repository-ledger.ts` — shared caps and validators.
- `packages/cli/src/daemon/domain/usecase/repository-ledger-service.ts` — daemon ledger
  refresh and snapshot reporting.
- `packages/cli/src/daemon/entry/bridge/repository-ledger-bridge.ts` — daemon ports and
  backend pass-through.
- `packages/cli/src/daemon/infrastructure/local/repository-ledger-store.ts` — atomic local
  ledger store.
