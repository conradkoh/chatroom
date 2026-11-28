---
type: best-practice
title: Daemon request lifecycle
description: Request row, daemon command and report mutations, monotonic states, by-id reads, client-derived waiting and timeouts, and the daemon dispatch rule.
tags: [daemon, convex, requests, lifecycle, git-clone, folder-browse]
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

A second layout serves interactive work where only the latest value matters: the pending-row session
used by folder browsing (see [Folder browse](#folder-browse-pending-row-session)). It keeps the
request-row shape but replaces the machine command with a pending-row subscription.

The git clone flow is the reference case:

- `request` in `services/backend/convex/gitCloneRequests.ts` validates the URL and target path, inserts a
  `chatroom_gitCloneRequests` row with status `pending`, and enqueues `daemon.gitClone`.
- `reportProgress` and `reportResult` in the same module are the daemon's reports.
- `get` is the only read. It takes a request id and returns the row.

## Machine backup download: the blob-owning variant

The backup download is the second reference case, and the one where a request row owns a stored
blob.

- `createInventoryRequest` / `createDownloadRequest` in
  `services/backend/convex/machineBackups.ts` insert a `chatroom_machineBackupRequests` row and
  enqueue `daemon.reportMachineBackups` or `daemon.uploadMachineBackup`.
- The daemon answers an inventory request with `reportInventory` and an upload request with
  `createUploadUrl`, a direct `POST`, then `reportUploaded` (or `reportFailed`).
  `createUploadUrl` moves the row to `preparing` and counts attempts; `reportUploaded` moves it to
  `ready`, records `sha256` and the `storageId`, and sets the 1-hour expiry.
- The browser mints a URL with `createDownloadAccess` (a mutation; moves ready → downloading and
  restarts the 1-hour window), streams the bytes, and calls `writeDownloadConfirmation` with the
  received byte count. The confirmation deletes the blob and moves the row to `downloaded`. Cancel
  and expiry delete the blob too.
- Reads stay by id (`getRequest`), plus one machine-wide `getActiveDownload` so another tab sees
  an active copy. `storageId`, `sha256` and URLs are never returned by a query.
- Late and duplicate reports are ignored, terminal rows are immutable, and every mutation after a
  terminal state returns an "ignored" result instead of throwing.
- Failure modes: `daemon_timeout` when the daemon never answers within the command window,
  `too_large` / `size_mismatch` / `checksum_mismatch` from the upload path, and `file_missing` /
  `not_a_file` / `file_changed` from inventory and re-stat. The UI derives retryability from the
  code.

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

## Folder browse: pending-row session

Interactive work that must feel immediate does not go through the machine command inbox. It uses a
pending-row session: the webapp writes a session row, the daemon subscribes to pending rows for its
machine, and it reports the listing for the navigation it was asked for. The subscription is not
serial and has no claim window, so a navigation can be superseded in place instead of queueing
behind a slow command.

- The contract is [folderBrowse.ts](../../services/backend/convex/folderBrowse.ts): `open`,
  `navigate`, `close`, `get`, `getListing`, the `daemonPending` subscription and `reportListing`.
- One `chatroom_folderBrowseSessions` row per browse, plus one replaceable
  `chatroom_folderBrowseListings` row. The selected path is never stored server-side.
- `open` creates the session at `navSeq: 1` in `pending`. Each `navigate` advances `navSeq` in place
  and returns the session to `pending`, so the latest navigation wins. A report applies only when
  its `navSeq` matches and the session is still `pending`; `reportListing` returns `applied`,
  `stale`, `duplicate`, `expired` or `not_found`, and anything but `applied` changes nothing.
- `close` (select or cancel) deletes both rows, so a session is ephemeral for the lifetime of the
  pick. `get` reads the header by id and `getListing` reads the one current listing, never history.
- The daemon side is `startFolderBrowse`
  ([start-folder-browse.ts](../../packages/cli/src/daemon/entry/folder-browse/start-folder-browse.ts)):
  it subscribes with `folderBrowse.daemonPending`, lists one directory per navigation through the
  `list-browse-directory` local action, and reports with `reportListing`. It keeps no queue, and it
  recovers after a restart because the pending rows are re-delivered.
- An idle session expires 10 minutes after `open` or the last `navigate`
  (`FOLDER_BROWSE_IDLE_TTL_MS`). `folderBrowse.cleanupExpiredFolderBrowseSessions` runs every five
  minutes, deletes 100 sessions per run with their listings, and reschedules itself when the batch
  is full. Machine deletion purges both tables.

### When to use a pending-row session instead of a command

- Use a `daemon.*` command for one-shot or long work where each item must run exactly once, in the
  machine's order: git clone, git refresh, local actions, agent start.
- Use a pending-row session for interactive or high-frequency work where only the latest state
  matters: folder browsing. The row is the queue, so superseding a navigation is one in-place write.

### Retired native folder picker

The native dialog is retired end to end. `daemon.pickFolder` maps to a no-op dispatch that logs and
acknowledges the event, and nothing enqueues it. The dispatch entry
([command-dispatch.ts](../../packages/cli/src/daemon/entry/command-dispatch.ts)), the payload
literal in
[machine-command.ts](../../services/backend/src/domain/entities/machine-command.ts), the event-type
label and the deprecated `chatroom_folderPickerRequests` table remain so historical inbox rows still
validate and display. The table has no writers or readers; its rows are kept until a later, approved
purge. Do not add new work on it.

## Related

- [New chatroom feature](../../apps/webapp/src/modules/chatroom/features/new-chatroom/README.md) — the
  clone states, the retry and the leave guard as the user sees them.
- [Remote folder browse feature](../../docs/features/remote-folder-browse.md) — the session contract,
  listing caps, path rules and failure outcomes.
