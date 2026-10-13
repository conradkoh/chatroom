---
type: best-practice
title: Daemon request lifecycle
description: Request row, daemon command and report mutations, monotonic states, by-id reads, client-derived waiting and timeouts, and the daemon dispatch rule.
tags: [daemon, convex, requests, lifecycle, git-clone, folder-picker]
status: stable
---

# Daemon request lifecycle

## Pattern

Work that the webapp asks a daemon to do is a request row. Every such request follows the same
three steps.

1. The webapp calls a mutation. The mutation inserts a request row and enqueues a `daemon.*` machine
   command for the machine.
2. The daemon performs the work, and reports progress and the result through `report*` mutations.
3. The webapp follows the row by its id, and derives what to show from it.

The git clone flow is the reference case:

- `request` in `services/backend/convex/gitCloneRequests.ts` validates the URL and target path, inserts a
  `chatroom_gitCloneRequests` row with status `pending`, and enqueues `daemon.gitClone`.
- `reportProgress` and `reportResult` in the same module are the daemon's reports.
- `get` is the only read. It takes a request id and returns the row.

## Invariants

- **Monotonic states.** The lifecycle is `pending` → `cloning` → `completed` or `failed`, and
  `pending` → `completed` or `failed` is also allowed. The backend enforces it
  ([gitCloneRequests.ts](../../services/backend/convex/gitCloneRequests.ts)).
- **Terminal rows are immutable.** A `completed` or `failed` row is never patched again.
- **Late and duplicate reports do not throw.** A progress report after a terminal result returns
  `ignored: true`. A second result returns `duplicate: true`, and the first terminal result wins.
- **A completed result must match.** A `completed` result must carry a cloned path equal to the
  requested target path.
- **Reads are by id.** The clone flow reads one row by request id, and `get` returns null for another
  user's row. Progress rows have no list query.
- **Waiting, stalled and timed-out are derived, not stored.** The backend stores only the status,
  the progress fields and the timestamps. The client derives the rest from those and a clock. The
  rule is in
  [deriveGitCloneViewState.ts](../../apps/webapp/src/modules/chatroom/features/new-chatroom/lib/deriveGitCloneViewState.ts).
- **The pickup window is the command's delivery window.** `daemon.gitClone` uses
  `MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS`, which is 5 minutes
  ([reliability.ts](../../services/backend/config/reliability.ts),
  [machine-command.ts](../../services/backend/src/domain/entities/machine-command.ts)). The clone
  runtime itself is not bounded by that window.
- **Errors carry registered codes.** The clone module throws `ConvexError` with codes from the backend
  error registry.

## Daemon dispatch rule

The rule is stated in [the daemon entry README](../../packages/cli/src/daemon/entry/README.md). The
machine command inbox sets the ordering
([machine-command-inbox.ts](../../packages/cli/src/daemon/infrastructure/convex/subscribers/machine-command-inbox.ts)).

- Agent commands serialize per chatroom, role and working directory. They also wait for the
  machine-wide tail.
- Every other command runs on the machine-wide tail, and waits for all workspace tails.
- A command is acknowledged after its handler returns.
- Long work starts a domain use case without awaiting it, and that use case owns its own dedup.

For `daemon.gitClone` the dedup has two levels:

1. [command-dispatch.ts](../../packages/cli/src/daemon/entry/command-dispatch.ts) skips an event id it
   has already seen.
2. The job runner in
   [run-git-clone-job.ts](../../packages/cli/src/daemon/domain/usecase/run-git-clone-job.ts) returns
   `started`, `duplicate` (the same request is running) or `busy` (another request owns the target
   folder). A busy result is reported to the backend as a failed clone with `target_not_empty`.

## Folder picker: legacy layout, migration pending

The folder picker follows the same three steps, in an older layout. It is the case to migrate.

- Its request row lives in `chatroom_folderPickerRequests`. The mutation that creates it, the query
  that reads it by id, and the report mutation `reportFolderPickerResult` all live in
  [machines.ts](../../services/backend/convex/machines.ts), not in a request module.
- Its command is `daemon.pickFolder`.
- It throws plain `Error` for an unknown request or a request on another machine. The clone module
  throws `ConvexError` with registered codes.
- A report on a request that is no longer `pending` returns `duplicate: true`.
- The webapp side is the `useFolderPicker` hook (`apps/webapp/src/hooks/useFolderPicker.ts`).

The migration to the clone module's layout is pending. Until it lands, new request-based work should
follow the clone flow, not this one.

## Related

- [New chatroom feature](../../apps/webapp/src/modules/chatroom/features/new-chatroom/README.md) — the
  clone states, the retry and the leave guard as the user sees them.
