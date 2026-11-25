# Feature: Chatroom export and import

**Status:** Implemented (CLI and backend)
**Last Updated:** 2026-11-26

---

## What it does

`chatroom export` writes one chatroom (its content and configuration) to a single JSON file.
`chatroom import` reads that file and creates a **new** chatroom owned by the importing user.

An export is a portable copy, not a backup: it carries conversation content and configuration,
never the source deployment's identity, credentials, binary attachments, or runtime state.

## Commands

Both commands live in `packages/cli/src/commands/chatroom-transfer/register.ts`.

### `chatroom export`

```
Usage: chatroom export [options]

Export one chatroom (content and configuration) to a JSON file. The file is
plaintext and contains conversation content; keep it private.

Options:
  --chatroom-id <id>  Chatroom identifier
  --path <dir>        Directory to write to (default: .chatroom/exports/)
  -h, --help          display help for command
```

- `--chatroom-id` is required.
- `--path` is a directory. It defaults to `.chatroom/exports/` under the current working
  directory. The default directory receives a `.gitignore` containing `*` when it has none, so
  exports stay out of version control; an existing `.gitignore` is never replaced. `--path` writes
  no ignore file, so a custom directory is not modified.
- The file name is `chatroom-<chatroomId>-YYYYMMDDTHHMMSSZ.json` (UTC, no colons).
- An existing file is never overwritten: the publish hard-links the temp file into place and a
  name clash fails with `EXPORT_FILE_EXISTS`.
- A filesystem without hard links cannot publish an export without overwriting it. The export then
  fails with `EXPORT_PUBLISH_UNSUPPORTED` and leaves no temp or final file.
- `export` takes no `--role` and no `--machine-id`.

### `chatroom import`

```
Usage: chatroom import [options]

Import an export file as a NEW chatroom owned by you. Never merges; importing
twice creates two chatrooms. Starts no agents.

Options:
  --machine-id <id>  Machine to bind workspaces to (default: this machine)
  --dry-run          Validate and print the plan; write nothing
  --path <file>      Export file to import
  -h, --help         display help for command
```

- `--path` is the export file and is required. A directory, a missing path or an unreadable file is
  refused with `IMPORT_FILE_UNREADABLE`. A file over `EXPORT_MAX_FILE_BYTES` (256 MiB) is refused
  with `IMPORT_FILE_TOO_LARGE` before it is read.
- `--machine-id` is optional. It names the machine workspaces are rebound to; it defaults to the
  current machine's identity.
- `--dry-run` validates the file, preflights the target machine, builds the plan, prints it and
  writes nothing.
- `import` takes no `--role`.

### Exit codes

- `0` — success, including a successful `--dry-run`.
- `1` — any refusal or failure. The CLI prints `❌ [CODE] message` and, where the failure names
  offending rows, one line per item.

## Format

The format is defined once in `services/backend/src/domain/entities/chatroom-transfer-file.ts`
and shared by the CLI and the backend.

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
- `checksum` is the lowercase hex SHA-256 of the canonical JSON of the content. Canonical JSON
  sorts object keys, emits no whitespace, drops `undefined` object properties and writes
  `undefined` array items as `null`. Only the twelve content properties are hashed, so `source`,
  `exportedAt`, `omitted` and `checksum` never affect the digest. Import recomputes it and refuses a
  mismatch with `IMPORT_CHECKSUM_MISMATCH`.
- The 12 content properties are `room`, `workspaces`, `agentConfigs`, `messages`, `messageQueue`,
  `tasks`, `backlog`, `artifacts`, `contexts`, `scheduledPrompts`, `savedCommands` and
  `skillCustomizations`. `room` is one object; the other eleven are arrays in that order.
- Every row has `_key` (a file-local ordinal such as `m12`, the reference unit) and
  `_creationTime` (informational; see Disclosures). References between rows are keys, not Convex
  ids. Content rows carry no Convex document ids and no user ids: `ownerId` fields are assigned to
  the importing user, and the only source identifier in the file is the top-level
  `source.chatroomId` metadata.
- `omitted` is the export's own manifest of what it did not carry. Its keys and reason wording come
  from the transfer registry; see the next section.

**The file is plaintext and contains conversation content.** Write it to a private directory, keep
it out of version control, and delete it when it is no longer needed. Every successful export ends
with the warning line `warning: this file is plaintext and contains conversation content. Keep it
private.`

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
- `chatroom_fileAttachments` — Binary attachments are refused before export.
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
- An export is refused when the chatroom has file attachments. It fails with
  `EXPORT_ATTACHMENTS_PRESENT` before reading any content, because binary attachments are not part
  of the format.
- The export has a size ceiling. A chatroom whose content would exceed 256 MiB is refused with
  `EXPORT_TOO_LARGE`, both while paging (an early approximate check) and on the exact serialized
  length.
- Per-user state is not carried. The chatroom's standing-instruction history and user
  file-storage settings live in per-user tables with no chatroom or workspace key, so neither is
  exported or restored. Agentic-query history is likewise not carried.

## Consistency

Export reads each category through separate Convex queries, so the consistency guarantee is
**detection, not isolation**. Before reading, export records a stamp: the room's activity fields,
the newest row and change high-water marks for every paginated category, task counts, and the
attachment count. After paging it re-reads every mutable category and compares its canonical JSON,
then re-reads the stamp. Any difference refuses the export with `EXPORT_CHATROOM_CHANGED`; the
caller is expected to run the export again, and the export never retries itself.

Residual gap: an in-place edit of an old message's `content` during the export window is not
detected, because append-only categories are protected only by the stamp's newest-row high-water
mark. No product mutation edits message content, so this cannot be triggered through normal use.

## Import behaviour

- Import always creates a **new** chatroom owned by the importing user. It never merges into an
  existing room; importing the same file twice creates two chatrooms.
- Validation happens before any write: JSON shape, kind, version, checksum, row shape, duplicate
  keys, dangling references, the target team structure and every working directory. A refusal
  creates nothing.
- Writes are chunked. Rows are grouped into phase-ordered chunks with row and byte caps, rows
  reference each other through file keys, and any reference whose target is not in a strictly
  earlier chunk is patched by a `links` chunk after the targets exist.
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

- Chunks are never retried. A failed chunk is `IMPORT_CHUNK_FAILED`, and the driver rolls the
  import back instead of replaying a partial write.
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
- `SIGINT` and `SIGTERM` during the write phase abort the import and trigger the same rollback.
- Residual: registering an imported workspace enqueues a `daemon.gitRefresh` command into
  `chatroom_machineCommandInbox`. That table is machine-keyed, so rollback does not remove the
  command. It is a read-only refresh that expires by its TTL and has no chatroom content.

## Registry

`services/backend/src/domain/usecase/chatroom-transfer/registry.ts` is the source of truth for what
the export carries, what the import rebuilds and what is left behind. Every chatroom-keyed table
must be classified there, either individually in `CHATROOM_SCOPED_TABLES` or through one family in
`CHATROOM_SCOPED_FAMILIES`. A new table that is not classified fails
`services/backend/src/domain/usecase/chatroom-transfer/registry.spec.ts`, which also checks field
rules, ref targets, rebuilt reasons, `omittedManifest()` entries, and every rollback/index
descriptor against an empty database.

See [chatroom transfer registry](/architecture/chatroom-transfer-registry.md) for the rule and the
three table families in more detail.
