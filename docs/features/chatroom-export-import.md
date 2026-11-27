# Feature: Chatroom export and import

**Status:** Implemented (CLI, backend, daemon and webapp)
**Last Updated:** 2026-11-27

---

## What it does

`chatroom export` writes one chatroom (its content and configuration) to a single JSON file, or
every chatroom you own on this machine to one bundle file with `--all`.
`chatroom import` reads either file and creates **new** chatrooms owned by the importing user. A
bundle can contain several chatrooms, so you choose which ones to import.

The webapp offers the same flows: it builds the same bytes and file names as the CLI, reads an
import file locally, and never uploads it.

An export is a portable copy, not a backup: it carries conversation content and configuration,
never the source deployment's identity, credentials, binary attachments, or runtime state.

Machine backups are a separate flow. The Machines tab can list the local-stack backups that exist
on a machine and download one through an ephemeral Convex copy; see [Machine backups](#machine-backups).

## Commands

Both commands live in `packages/cli/src/commands/chatroom-transfer/register.ts`.

### `chatroom export`

```
Usage: chatroom export [options]

Export one chatroom (--chatroom-id) or every chatroom you own on this machine
(--all) to one JSON bundle. The files are plaintext and contain conversation
content; keep them private.

Options:
  --chatroom-id <id>  Chatroom identifier (exclusive with --all)
  --all               Export every chatroom you own that has an active workspace
                      on this machine, into one bundle file
  --path <dir>        Directory to write to (default: .chatroom/exports/)
  -h, --help          display help for command
```

- Exactly one of `--chatroom-id <id>` or `--all` is required.
- `--path` is a directory. It defaults to `.chatroom/exports/` under the current working
  directory. The default directory receives a `.gitignore` containing `*` when it has none, so
  exports stay out of version control; an existing `.gitignore` is never replaced. `--path` writes
  no ignore file, so a custom directory is not modified.
- The single-chatroom file name is `chatroom-<chatroomId>-YYYYMMDDTHHMMSSZ.json` (UTC, no colons).
- The `--all` bundle name is `chatroom-all-<machineId>-YYYYMMDDTHHMMSSZ.json` (UTC, no colons).
  Characters outside `[A-Za-z0-9_-]` in the machine id become `_`.
- An existing file is never overwritten: the publish hard-links the temp file into place and a
  name clash fails with `EXPORT_FILE_EXISTS`.
- A filesystem without hard links cannot publish an export without overwriting it. The export then
  fails with `EXPORT_PUBLISH_UNSUPPORTED` and leaves no temp or final file.

#### Single chatroom

- The file contains one chatroom in the v1 format described below.
- The command prints `Exported chatroom <id>`, the file path, per-category counts, the omission
  list, one attachment line when attachments were left out, and the plaintext warning.

#### `--all` bundle

- `--all` exports every chatroom the caller owns that has an active workspace on the current
  machine. Ownership is the filter, so another user's chatroom on the same machine is never
  exported, even though its workspace row is visible to the machine.
- `--all` covers the current machine only. It reads the machine's identity, so a machine without
  one fails with `EXPORT_NO_MACHINE_IDENTITY`.
- `--all` writes exactly **one** bundle file, never one file per chatroom. It builds the bundle in
  memory and publishes it once, so a failed run leaves no file and no temp file.
- The bundle contains one v1 chatroom payload per chatroom, in the machine list's order (most
  recent activity first). `index` and `chatrooms` have the same order.
- A chatroom that fails is retried once. If it fails again, the whole run fails with
  `EXPORT_ALL_INCOMPLETE`, prints one `❌ [CODE] <chatroomId>: message` line per failed chatroom,
  and writes no file. A partial bundle is never published.
- `EXPORT_TOO_LARGE` is never retried. The bundle is limited to 256 MiB; a chatroom that would
  cross the remaining budget fails the whole run before publish.
- An empty list writes nothing and exits `0` with
  `No chatrooms found for machine <id> that you own.`
- A successful run prints `Exported N chatrooms from machine <id>`, the file path, the size, one
  attachment line when attachments were left out, and the plaintext warning once.
- `export` takes no `--role` and no `--machine-id`.

#### Export errors

- `EXPORT_TARGET_REQUIRED` — neither `--chatroom-id` nor `--all` was given.
- `EXPORT_TARGET_CONFLICT` — both `--chatroom-id` and `--all` were given.
- `EXPORT_NO_MACHINE_IDENTITY` — `--all` ran on a machine with no identity.
- `EXPORT_MACHINE_TOO_LARGE` — the machine has more than 1000 active workspace rows, counting
  other users' chatrooms. The list is refused rather than truncated; export individual chatrooms
  with `--chatroom-id`.
- `EXPORT_ALL_INCOMPLETE` — at least one chatroom failed twice during `--all`; no file was written.
- `EXPORT_TOO_LARGE` — the serialized file or the bundle would exceed 256 MiB.
- `EXPORT_FILE_EXISTS` — a file with the generated name already exists.
- `EXPORT_PUBLISH_UNSUPPORTED` — the filesystem cannot hard-link the temp file into place.
- `EXPORT_CHATROOM_CHANGED` — the chatroom changed during the export; run the export again.

### `chatroom import`

```
Usage: chatroom import [options]

Import chatrooms from an export file as NEW chatrooms owned by you. Listing the
file needs no login. Importing needs a login and an owned target machine. Never
merges; importing twice creates two chatrooms. Starts no agents.

Options:
  --machine-id <id>        Machine to bind workspaces to (default: this machine)
  --dry-run                Validate and print the plan; write nothing
  --select <all|id[,id...]> Chatrooms to import from a bundle: all, or
                           positions/source ids separated by commas. Without
                           it, a terminal prompts.
  --list                   Print the chatrooms in the file and exit. Needs no
                           login and writes nothing.
  --path <file>            Export file to import
  -h, --help               display help for command
```

- `--path` is the export file and is required. A directory, a missing path or an unreadable file is
  refused with `IMPORT_FILE_UNREADABLE`. A file over 256 MiB is refused with
  `IMPORT_FILE_TOO_LARGE` before it is read.
- `--machine-id` is optional. It names the machine workspaces are rebound to; it defaults to the
  current machine's identity. A missing identity is `IMPORT_NO_MACHINE_IDENTITY`.
- `--dry-run` validates the file, preflights the target machine, builds the plan, prints it and
  writes nothing.
- `import` takes no `--role`.

#### Listing the file

- Listing needs no session, no network call and no machine id (D5). `--list` prints the file's
  chatrooms and exits `0` without writing anything.
- A bundle import always prints the listing first, so the numbers and ids the prompt accepts are on
  screen. A single-chatroom import prints its one-entry listing only with `--list`; without it the
  chatroom imports directly.
- Each entry prints its 1-based position, name (or `Untitled chatroom`), source chatroom id, team
  structure, status, export time, message/task/backlog counts, working-directory count, and any
  omitted attachments.
- A bundle entry whose payload fails validation is listed with
  `not importable: <CODE> — <message>` instead of refusing the whole bundle. The other entries stay
  importable. A bundle-level index checksum mismatch still refuses the whole file.

#### Choosing chatrooms

- A single-chatroom file has nothing to choose; it imports its one chatroom with no prompt.
- A bundle needs `--select`, or an interactive terminal. `--select all` selects every importable
  entry. `--select 1,3,<sourceChatroomId>` accepts 1-based positions and source chatroom ids,
  comma-separated.
- Without `--select` and without a terminal, the command refuses with
  `IMPORT_SELECTION_REQUIRED` instead of guessing.
- An empty answer or an empty token list prints `Nothing selected; nothing was imported.` and exits
  `0`. `--select all` on a bundle with no importable entry is `IMPORT_SELECTION_INVALID`.
- An unknown or invalid token is `IMPORT_SELECTION_INVALID`, naming the token.

#### Running the import

- The session and the target machine are read **after** the selection is known. A file-level
  listing never authenticates. A write needs the importer's session and an owned target machine;
  the machine may be offline (D5, D6).
- Importing never checks who exported the file, whether the source chatroom still exists, or which
  machine exported it. Those checks would block reproduction and protect nothing the importer's own
  session does not already protect. The checksum remains an integrity check, not an auth check.
- Target refusals are kept because they would corrupt data: unknown team structure
  (`IMPORT_UNKNOWN_TEAM_STRUCTURE`), invalid working-directory format
  (`IMPORT_INVALID_WORKING_DIR`), and a machine that is missing or not owned
  (`IMPORT_MACHINE_NOT_FOUND`, `IMPORT_MACHINE_NOT_OWNED`).
- Selected chatrooms import one at a time, in selection order. Each import has its own
  `begin`/`applyChunk`/`finalize`/`rollback`, so one failure never rolls back an earlier success.
- A target-wide refusal (missing/not-owned machine or auth) stops the run and marks every remaining
  entry `skipped: fatal`.
- `SIGINT` and `SIGTERM` abort the chatroom in progress through its own rollback; the remaining
  entries are marked `skipped: cancelled`.
- A bundle run ends with `Imported X of Y selected; Failed: Z` and, when any succeeded,
  `new chatrooms: <ids>`. A single-chatroom run prints `Imported as new chatroom <id>`.
  A successful run also prints `no agents were started`.
- `--dry-run` prints the same plan per entry and `dry run: nothing was written`; it makes no write
  call.

## Format

The format is defined once in `services/backend/src/domain/entities/chatroom-transfer-file.ts`
and shared by the CLI, the backend and the browser.

### Single chatroom (v1)

```json
{
  "formatVersion": 1,
  "kind": "chatroom-export",
  "source": { "chatroomId": "<source chatroom id>", "cliVersion": "<cli version>" },
  "exportedAt": "<ISO-8601>",
  "omitted": { "<key>": { "count": null, "reason": "<why>" } },
  "checksum": "<lowercase hex SHA-256>",
  "room": { "…": "…" },
  "workspaces": [],
  "agentConfigs": [],
  "messages": [],
  "messageQueue": [],
  "tasks": [],
  "backlog": [],
  "artifacts": [],
  "contexts": [],
  "scheduledPrompts": [],
  "savedCommands": [],
  "skillCustomizations": []
}
```

- `formatVersion` is `1`. `kind` is `"chatroom-export"`; a file with another kind is refused with
  `IMPORT_NOT_AN_EXPORT`, and another version with `IMPORT_UNSUPPORTED_VERSION`.
- `source` records the exporting chatroom and CLI version. It is metadata; import never reuses the
  chatroom id.
- `exportedAt` is the export clock reading.
- `checksum` is the lowercase hex SHA-256 of the canonical JSON of the twelve content properties.
  Canonical JSON sorts object keys, emits no whitespace, drops `undefined` object properties and
  writes `undefined` array items as `null`. `source`, `exportedAt`, `omitted` and `checksum` never
  affect the digest. Import recomputes it and refuses a mismatch with
  `IMPORT_CHECKSUM_MISMATCH`.
- The 12 content properties are `room`, `workspaces`, `agentConfigs`, `messages`, `messageQueue`,
  `tasks`, `backlog`, `artifacts`, `contexts`, `scheduledPrompts`, `savedCommands` and
  `skillCustomizations`. `room` is one object; the other eleven are arrays in that order.
- Every row has `_key` (a file-local ordinal such as `m12`, the reference unit) and
  `_creationTime` (informational; see Disclosures). References between rows are keys, not Convex
  ids. Content rows carry no Convex document ids and no user ids: `ownerId` fields are assigned to
  the importing user, and the only source identifier in the file is the top-level
  `source.chatroomId` metadata.
- `omitted` is the export's own manifest of what it did not carry. Its keys and reason wording come
  from the transfer registry; see the next section. `bytes` is present only for
  `chatroom_fileAttachments`, which is counted and measured.

### Bundle (`chatroom export --all`)

```json
{
  "formatVersion": 1,
  "kind": "chatroom-export-bundle",
  "exportedAt": "<ISO-8601>",
  "source": { "machineId": "<id or null>", "cliVersion": "<cli version>" },
  "index": [
    {
      "sourceChatroomId": "<source chatroom id>",
      "name": "<room name or null>",
      "status": "active" | "completed",
      "teamStructureId": "<team id>",
      "lastActivityAt": 123 | null,
      "messageCount": 0,
      "taskCount": 0,
      "backlogCount": 0,
      "workingDirs": ["/path"],
      "omittedAttachments": { "count": 0, "bytes": 0 },
      "checksum": "<the payload's v1 checksum>"
    }
  ],
  "chatrooms": [ { "formatVersion": 1, "kind": "chatroom-export", "…": "…" } ],
  "checksum": "<lowercase hex SHA-256>"
}
```

- `index` and `chatrooms` have the same length and order. Each `index` entry describes one payload
  for the listing and pins that payload's own v1 `checksum`.
- The bundle `checksum` is `sha256Hex(canonicalJson({ formatVersion, kind, index }))`. It covers
  only those three properties, so re-exporting an unchanged machine at another instant yields the
  same digest. A changed index is `IMPORT_CHECKSUM_MISMATCH` and refuses the whole file.
- A changed payload no longer matches its index entry's `checksum`; that entry is marked
  `not importable` (also `IMPORT_CHECKSUM_MISMATCH`) and the other entries stay importable.
- `source`, `exportedAt` and the payload metadata are display-only; import never reads them for
  identity.

**The file is plaintext and contains conversation content.** Write it to a private directory, keep
it out of version control, and delete it when it is no longer needed. Every run that writes at
least one file prints the warning line `warning: this file is plaintext and contains conversation
content. Keep it private.` In single-chatroom mode it follows the report; in `--all` mode it is
printed once, as the last line of the run.

## What is exported and what is not

The registry at `services/backend/src/domain/usecase/chatroom-transfer/registry.ts` is the single
source of truth. Exported tables are copied with a per-field rule; rebuilt tables are regenerated
from imported content; everything else is deliberately excluded. The export writes the excluded and
rebuilt decisions into `omitted`, using these exact reasons:

<!-- BEGIN GENERATED OMISSIONS — keep in sync with omittedManifest() -->

- `agentic_query_history` — User search and ask history is not carried in this PR (disclosed gap).
- `attachedWorkflows` — Deprecated workflow attachments are not carried.
- `backlogDeleted` — Backlog rows with status deleted are filtered out and counted.
- `chatroomWorkspaceAgentConfigInbox` — Machine inbox events are runtime delivery state.
- `chatroomWorkspaceTaskInbox` — Machine inbox events are runtime delivery state.
- `chatroom_activeTaskHeaders` — Active task headers are derived from imported task state.
- `chatroom_agentDesiredConfigs` — Deprecated desired-config rows; replaced by launch requests.
- `chatroom_agentRestartMetrics` — Runtime restart telemetry; not portable.
- `chatroom_agentRoleStatusReadModel` — Agent status is a daemon projection of live processes.
- `chatroom_agentRuntimeStates` — Live agent process state; rebuilt by the daemon on the target machine.
- `chatroom_capabilities_refresh_batches` — Runtime capability-refresh bookkeeping; not portable.
- `chatroom_capabilities_refresh_machine_results` — Runtime capability-refresh bookkeeping; not portable.
- `chatroom_connectionCloseRequests` — Live connection control messages; not portable.
- `chatroom_conversationModePreferences` — Per-user conversation mode preference.
- `chatroom_favorites` — Per-user favorites; the importing user starts fresh.
- `chatroom_fileAttachments` — Binary attachments are not carried; the file records how many were left out.
- `chatroom_fileStorageSettings` — Chatroom storage policy; not content.
- `chatroom_fileStorageUsage` — Storage usage is per-user runtime accounting.
- `chatroom_integrations` — Integration credentials (bot tokens) are never exported.
- `chatroom_machineObservedWorkspaceViews` — Runtime machine observation; rebuilt by the daemon.
- `chatroom_messageReadModelState` — Read-model counters are derived from imported messages.
- `chatroom_messageReadModels` — Read models are derived from imported messages.
- `chatroom_observation` — Runtime observation timestamps; rebuilt by the daemon.
- `chatroom_participants` — Live connection state; participants rejoin the imported room.
- `chatroom_read_cursors` — Per-user read position; absence means unread.
- `chatroom_skillActivations` — Runtime skill activation log; not portable.
- `chatroom_taskCounts` — Task counts are derived from imported tasks.
- `chatroom_taskDeliveryReceipts` — Delivery receipts describe the source run; not portable.
- `chatroom_timelineTaskStatusSignals` — Timeline signals are derived from imported task state.
- `chatroom_unreadStatus` — Unread markers are per-user runtime state.
- `chatroom_workflow_steps` — Deprecated workflow feature.
- `chatroom_workflows` — Deprecated workflow feature.
- `command_runner` — Command runner state is machine-local.
- `launchRequestsOtherTeam` — Launch requests for other teams are filtered out and counted.
- `launchRequestsSuperseded` — Older launch requests for the same workspace and role are superseded by the latest.
- `workspaceRemovals` — Workspaces removed before export are not carried.
- `workspace_caches` — Workspace caches are rebuilt by the target daemon.
- `workspace_requests` — In-flight workspace requests belong to the source daemon.

<!-- END GENERATED OMISSIONS -->

Three registry decisions are not tables:

- **Families with one decision.** `workspace_caches` (rebuilt by the target daemon),
  `workspace_requests` (in-flight source-daemon requests), `command_runner` (machine-local state)
  and `agentic_query_history` (the disclosed search/ask gap) group tables that share one reason.
- **Counted row filters.** `workspaceRemovals`, `backlogDeleted`, `launchRequestsOtherTeam` and
  `launchRequestsSuperseded` are rows the build drops and counts; their `omitted` entry carries the
  count instead of `null`.
- **Field drops.** Some exported rows omit individual fields (for example `attachedFileIds` on
  messages, `assignedTo` on backlog items, and deprecated team fields on the room). Those decisions
  live in the table's `fields` map and do not appear in `omitted`.

## Disclosures

- `_creationTime` is not restored. Every imported row receives the import time as its Convex
  `_creationTime`; relative order within a category is preserved, but the original timestamps are
  not. Row-level `createdAt`, `updatedAt` and `completedAt` fields that the registry marks `copy`
  are carried verbatim.
- Agentic-query history is not carried. User search/ask queries, their turns, runs and messages
  stay in the source deployment (the `agentic_query_history` family).
- Invalid and Windows-style paths are refused. Workspace `workingDir` values must be POSIX absolute
  paths after normalization; a relative path, a Windows drive/backslash path, or a path containing
  shell metacharacters fails the import with `IMPORT_INVALID_WORKING_DIR` before any write, naming
  every offending directory.
- File modes are POSIX-only. The export directory is created with mode `0700` and the export file
  with mode `0600`. On Windows the mode bits are ignored and the file is protected only by the
  containing directory's ACLs.
- An export of a chatroom with file attachments succeeds. Attachment rows and message references
  to them are left out. `omitted.chatroom_fileAttachments` records the count and total bytes, and
  the CLI prints `N attachment(s) not included (<size>)`. A count above 1000 is shown as
  `more than 1000`.
- The export has a size ceiling. A chatroom whose content would exceed 256 MiB is refused with
  `EXPORT_TOO_LARGE`, both while paging (an early approximate check) and on the exact serialized
  length. A bundle is refused when its running total would cross the ceiling.
- The browser reads the file into memory. The import dialog checks the 256 MiB ceiling before
  reading, then parses and validates locally; a file at the ceiling temporarily uses well over its
  own size in memory. No bytes are uploaded.
- Per-user state is not carried. The chatroom's standing-instruction history and user
  file-storage settings live in per-user tables with no chatroom or workspace key, so neither is
  exported or restored. Agentic-query history is likewise not carried.

## Consistency

Export reads each category through separate Convex queries, so the per-chatroom consistency
guarantee is **detection, not isolation**. Before reading, export records a stamp: the room's
activity fields, the newest row and change high-water marks for every paginated category, task
counts, and the attachment count. After paging it re-reads every mutable category and compares its
canonical JSON, then re-reads the stamp. Any difference refuses that chatroom with
`EXPORT_CHATROOM_CHANGED`; the caller is expected to run the export again, and the export never
retries itself.

A bundle is all-or-nothing. Each chatroom is read and checked independently; a chatroom that fails
is retried once, and if it still fails the whole bundle is discarded with `EXPORT_ALL_INCOMPLETE`.
No partial bundle is written.

Residual gap: an in-place edit of an old message's `content` during the export window is not
detected, because append-only categories are protected only by the stamp's newest-row high-water
mark. No product mutation edits message content, so this cannot be triggered through normal use.

## Import behaviour

- Import always creates a **new** chatroom owned by the importing user. It never merges into an
  existing room; importing the same file twice creates two chatrooms.
- Validation happens before any write: JSON shape, kind, version, checksum, row shape, duplicate
  keys, dangling references, the target team structure and every working directory. A refusal
  creates nothing.
- Writes are chunked. Rows are grouped into phase-ordered chunks with row and byte caps (200 rows
  and 1.5 MB per chunk), rows reference each other through file keys, and any reference whose target
  is not in a strictly earlier chunk is patched by a `links` chunk after the targets exist.
- `--dry-run` performs validation and preflight, prints the same plan the write phase would use,
  prints `dry run: nothing was written`, and makes no write call.
- No agent is started. A successful import ends with `no agents were started`; the daemon starts
  nothing until the user asks it to.
- Agent configs (the last launch sent per role) are restored only when the target machine reports
  the harness and the workspace survives. A config is skipped with one of these reasons:
  `no_workspace`, `working_dir_mismatch` when its `workingDir` differs from its workspace's
  normalized directory, `non_remote_agent_type`, `empty_model`, `harness_unavailable`, or
  `superseded_by_merge` when an older row for the same surviving workspace and role is superseded
  by the last one. A skipped config is reported and the import still completes. A plain error from
  the shared agent-config save is reported as `IMPORT_CHUNK_FAILED` with its message, which rolls
  the import back.
- Scheduled prompts are imported paused: `isRunnable` is written `false` and `disabledReason` is
  kept only when the source prompt was `completed` or `failed` (otherwise set to `user`). Nothing
  fires before the user reviews it.
- Non-terminal tasks are reset to `pending` and lose `acknowledgedAt`, `startedAt`,
  `deliveryFailure` and `sessionPolicyConsumedAt`. Terminal statuses are carried verbatim.
- Duplicate workspaces (the same normalized working directory) collapse to one survivor; refs are
  rewritten to it and `fileTreeSyncEnabled` survives if any member enabled it.

## Failure and rollback

- Chunks are never retried. A failed chunk is `IMPORT_CHUNK_FAILED`, and the driver rolls that
  chatroom back instead of replaying a partial write. Other selected chatrooms are unaffected.
- Rollback deletes the new chatroom's rows by chatroom id, in child-first order, so no scan is
  needed. It repeats in budgeted calls until one call deletes nothing; there is no call-count
  limit, and a room of any size drains. A call that deletes nothing reports
  `rollback made no progress`, the only stop. The room row is deleted last, after every other table
  drains. The new chatroom id is printed at `import started`, before any chunk lands.
- A rolled-back import exits `1` with `IMPORT_ROLLED_BACK` and says the import did not complete and
  no rows were kept.
- A failed rollback exits `1` with `IMPORT_ROLLBACK_FAILED`, names the orphan chatroom id, and says
  the room may still exist **and may be active; archive or delete it in the webapp**. Rollback
  refuses active rooms, so a failed rollback can leave an active room that the user must archive or
  delete.
- The importing room may be visible as `completed` between `begin` and `finalize`. It becomes the
  exported status only when finalize runs.
- Rollback uses the same guard as every import write: it accepts the room only while it is
  `completed`, owned by the caller, and younger than 24 hours (`IMPORT_WINDOW_MS`). `finalizeImport`
  sets the status from the plan, so a room finalized as `completed` (source status `completed`)
  remains rollback-able until the window closes; finalize does not protect it. A room finalized as
  `active` is refused by rollback. If finalize commits and the response is then lost, that complete
  room stays, and the user must archive or delete it in the webapp. The window also stops the
  mutation from deleting unrelated chatroom history; a killed process that leaves an archived,
  partial chatroom leaves it past that window eventually, and the user can archive or delete it
  with the id printed at `import started`.
- `SIGINT` and `SIGTERM` during the write phase abort the chatroom in progress and trigger the same
  rollback; the remaining selected chatrooms are reported as not started.
- Residual: registering an imported workspace enqueues a `daemon.gitRefresh` command into
  `chatroom_machineCommandInbox`. That table is machine-keyed, so rollback does not remove the
  command. It is a read-only refresh that expires by its TTL and has no chatroom content.

## Webapp

### Export

- Entry points: the chatroom sidebar row's context menu, the chatroom selector card menu, the
  selector table menu, and the Machines tab's per-machine card menu.
- The browser builds the same payload bytes and file names as the CLI by calling the shared
  `runExport` / `runExportBundle` code, then saves the file with an anchor download. Nothing is
  uploaded to Convex.
- "Export chatroom" is per chatroom. "Export chatrooms" on a machine card produces one
  `chatroom-all-<machineId>-<timestamp>.json` bundle.
- The machine export shows its listing, exporting progress, empty state, success state, the
  `EXPORT_ALL_INCOMPLETE` failure with the failed chatroom ids, and the `EXPORT_TOO_LARGE` failure
  with the size limit. A failed export writes no file.
- Export runs only while the user asks; there is no background or scheduled export.

### Import

- Entry points: the chatroom sidebar header, the chatroom selector header, and the selector's empty
  state.
- The dialog has four steps: **File**, **Select**, **Progress** and **Results**. The file is chosen
  with a native file input and read with the browser's file API; it is never uploaded.
- The dialog calls the same `parseTransferFile`/`selectEntries` code as the CLI, so listing,
  validation, `not importable` entries and checksums behave identically. The size gate runs before
  the file is read.
- Select shows the same per-entry fields as the CLI listing, a select-all control, and a target
  machine picker. Results show each imported chatroom as a link to
  `/app/chatroom?id=<new id>`, each failure with its code and message, and allow retrying the
  failed/skipped entries while leaving successful ones unselectable.
- Stop/cancel aborts the import in progress and waits for its rollback; close is blocked while the
  rollback runs. The engine writes through `chatroomImport.begin/applyChunk/finalize/rollback`
  only; there is no upload route or Convex action for a transfer file.
- A killed tab cannot run rollback. The dialog records the in-progress import in `localStorage`
  with a heartbeat; the next visit shows an interrupted-import notice that can remove or keep the
  record. A room finalized as `active` cannot be rolled back, exactly as in the CLI.

## Machine backups

### What a backup is

- A backup is the local Convex stack's archive produced by `convex export --include-file-storage`.
  The local dashboard writes it to `services/backend/.convex/user-backups` on that machine as
  `backup-YYYYMMDD-HHMMSS.zip`.
- The inventory counts only files matching `backup-YYYYMMDD-HHMMSS.zip` (D12). The local dashboard
  lists any `*.zip`, so the two counts can differ when stray zips exist; this is intentional.
- Backups are created only by the local dashboard. This feature reports and downloads the ones that
  exist; it never creates, schedules, restores or imports one.

### Listing backups

- The Machines tab's expanded card contains the Backups section. Nothing is requested until the
  user presses **Check backups**; expanding the card does not start a request.
- The request is a `daemon.reportMachineBackups` machine command answered by
  `machineBackups.reportInventory`. The reply is a snapshot: count, newest timestamp, total size,
  the directory, and up to 200 entries (the rest sets `truncated`).
- The section shows the empty state, the machine-offline state, the no-local-stack state (a cloud
  machine), the connecting state, the daemon-timeout state with a retry, and read failures.
- A completed snapshot expires after 10 minutes. Pressing **Check backups** again, or **Refresh**,
  asks the daemon for a new snapshot.

### Downloading one backup

- Download always opens a warning first. The warning names the machine and says the archive
  contains the whole local Convex deployment, including bot tokens and session data; focus starts
  on Cancel.
- Confirming enqueues `daemon.uploadMachineBackup`. The daemon reports the file's size, mints an
  upload URL, posts the bytes to Convex storage, reports the SHA-256 and size, then re-stats the
  file. Only a regular, non-symlink `backup-YYYYMMDD-HHMMSS.zip` is served; the daemon never
  creates the directory and refuses a file that changed during the upload.
- The states are: **Requested** → **Preparing** (elapsed counter) → **Ready** (expiry counter) →
  **Downloading** (byte progress) → **Done**, with Cancel at every active state.
- The stored copy is ephemeral:
  - It is deleted when the browser has received the expected number of bytes and
    `writeDownloadConfirmation` succeeds (the app retries the confirmation, and says so if the
    cloud copy could not be removed).
  - Cancel deletes it immediately.
  - It expires 1 hour after it became ready, or 1 hour after the last download started.
  - Deleting the machine deletes it with the machine purge.
  - Terminal rows are kept for 10 minutes so the result can be read, then the cron deletes them.
- One download at a time per machine. A second request while one is active is refused
  (`BACKUP_REQUEST_ACTIVE`); the other rows are disabled with an explanation.
- A backup larger than 256 MiB is listed but cannot be downloaded (`BACKUP_TOO_LARGE`); the row
  says to copy it from the machine directly.
- An offline machine is refused (`MACHINE_OFFLINE`) rather than queued: an upload queued for later
  would be stale.
- Access is owner-only through the session. No query returns `storageId`, `sha256` or a URL;
  `createDownloadAccess` (a mutation) mints a fresh URL for one attempt and never stores it. The
  URL is an unauthenticated bearer capability for its short lifetime, so it is only minted for the
  owner and the blob is deleted as soon as receipt is confirmed.
- The download is a `fetch` stream, not an anchor download, so byte receipt is observable. If the
  body is shorter than the reported size, the download fails with `size_mismatch` and no file is
  saved. The saved file is the backup exactly as the daemon uploaded it.

## Registry

`services/backend/src/domain/usecase/chatroom-transfer/registry.ts` is the source of truth for what
the export carries, what the import rebuilds and what is left behind. Every chatroom-keyed table
must be classified there, either individually in `CHATROOM_SCOPED_TABLES` or through one family in
`CHATROOM_SCOPED_FAMILIES`. A new table that is not classified fails
`services/backend/src/domain/usecase/chatroom-transfer/registry.spec.ts`, which also checks field
rules, ref targets, rebuilt reasons, `omittedManifest()` entries, and every rollback/index
descriptor against an empty database.

The machine backup request table is machine-keyed, not chatroom-keyed, and lives in
`MACHINE_SCOPED_TABLES` instead.

See [chatroom transfer registry](/architecture/chatroom-transfer-registry.md) for the rule and the
three table families in more detail.
