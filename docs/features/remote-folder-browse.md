# Feature: Remote Folder Browsing

**Status:** Implemented end to end; the native folder picker is retired.
**Last Updated:** 2026-11-28

---

## Why

The Browse button must work when the web UI runs on a different machine than the daemon. The native
dialog (`daemon.pickFolder` + `osascript`/`PowerShell`/`zenity`) opens on the daemon's screen and
blocks the daemon event loop, so it is retired. Typed absolute paths keep working.

## Surfaces

New-chatroom existing folder, clone target folder, setup wizard, switch-workspace choose step, and
the machines page add-project-root field. All five share one folder field and one picker hook.

## Session lifecycle

One `chatroom_folderBrowseSessions` row per pick and one replaceable
`chatroom_folderBrowseListings` row. States are `pending | ready | error`.
`open` creates the session (`navSeq: 1`, pending). `navigate` advances `navSeq` in place and
returns the session to pending; the daemon applies only the matching `navSeq`, so the latest
navigation wins and stale/duplicate/expired reports change nothing. `close` (select or cancel)
deletes both rows. The selected path is never stored server-side.

## API

| Function        | Args                                                                | Returns                                             | Errors                                                                                                |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `open`          | `machineId`, `path?`                                                | `{ browseId }`                                      | `NOT_AUTHENTICATED`, `MACHINE_NOT_FOUND`, `NOT_AUTHORIZED_MACHINE`, `FOLDER_BROWSE_INVALID_PATH`      |
| `navigate`      | `browseId`, `path` (string or null = home), `showHidden`, `filter?` | `{ navSeq }`                                        | `NOT_AUTHENTICATED`, `FOLDER_BROWSE_NOT_FOUND`, `FOLDER_BROWSE_EXPIRED`, `FOLDER_BROWSE_INVALID_PATH` |
| `close`         | `browseId`                                                          | `{ closed }`                                        | `NOT_AUTHENTICATED`                                                                                   |
| `get`           | `browseId`                                                          | header view or `null`                               | —                                                                                                     |
| `getListing`    | `browseId`                                                          | listing view or `null`                              | —                                                                                                     |
| `daemonPending` | `machineId`                                                         | pending rows for the caller (max 20, unexpired)     | — (empty when unauthorized)                                                                           |
| `reportListing` | `machineId`, `browseId`, `navSeq`, `result`                         | `applied / stale / duplicate / expired / not_found` | `NOT_AUTHENTICATED`, `MACHINE_NOT_FOUND`, `NOT_AUTHORIZED_MACHINE`, `FOLDER_BROWSE_INVALID_LISTING`   |

`reportListing` checks run in this order: `not_found` (missing, or owned by another user), machine
mismatch (throw), `expired`, `stale`, `duplicate`, listing validation, then the write.

## Listing contract and caps

One directory per response, directories only: `{ name, symlink?: true }`, sorted case-insensitively
with numeric ordering. Files are counts only (`fileCount`), never names or contents.
`dirCount` is the number of matching directories found, `truncated = entries.length < dirCount`,
`complete: false` means the daemon hit its scan or time budget.

| Limit                            | Value                                    |
| -------------------------------- | ---------------------------------------- |
| Entries per listing              | 500 (`FOLDER_BROWSE_MAX_ENTRIES`)        |
| Name length                      | 255 characters                           |
| Name bytes per listing           | 64 KiB (`FOLDER_BROWSE_MAX_NAME_BYTES`)  |
| Path length                      | 1024 characters                          |
| Filter length                    | 128 characters                           |
| Error message                    | 500 characters                           |
| Live sessions per user + machine | 3                                        |
| Daemon pending rows              | 20                                       |
| Idle TTL                         | 10 minutes (`FOLDER_BROWSE_IDLE_TTL_MS`) |

## Hidden entries, symlinks, filter

Hidden (dot-named) entries are skipped unless `showHidden` and are counted in `hiddenCount`.
Symlinked directories are listed with `symlink: true` and can be followed; one level per request, so
loops cannot occur. A case-insensitive `filter` substring is applied daemon-side before the cap,
which replaces pagination for huge directories.

## Paths

`normalizeBrowsePath` (shared) trims, requires a leading `/`, caps at 1024 characters, rejects
any C0 control character or DEL (including `\0`, `\t`, `\r`, `\n`, ESC and `\x7f`) and any `..`
segment, collapses repeated `/`, drops `.`, and strips a trailing `/` except at root. `/` is
browsable. Daemon-side, a directory whose name contains a control character or `/` is never listed;
it is counted with the files, so a report never violates the backend's entry-name rule. The
normalizer deliberately does not apply the working-directory shell blocklist, so names such as
`My (old) #2` can be browsed. Whether a folder may be _selected_ is
`listing.selectable`, computed by the backend with `normalizeWorkingDir`, which rejects `/` and the
shell blocklist. Paths are POSIX only; a Windows daemon reports `UNSUPPORTED_PLATFORM`.

## Security boundary

Owner plus machine only: `userId` is the opener and `machineId` must be owned by the caller
(`getOwnedMachine`); `daemonPending` serves only rows that the daemon session's user owns, on a
machine that user owns, and only while they are unexpired. There is
no containment root — the owner may browse any absolute directory the daemon's OS user can read,
which is no broader than what that owner's agents already execute on the machine. Exposure is
minimal (directory names only, no file names or contents), only on explicit request, and deleted at
session end.

## Expiry and cleanup

`expiresAt` is 10 minutes after `open` and after every `navigate`. `close` deletes both rows. The
`folderBrowse.cleanupExpiredFolderBrowseSessions` cron runs every 5 minutes, deletes 100 sessions
per run with their listings, and reschedules itself when the batch is full, so an abandoned session
is gone in about 15 minutes. Machine deletion purges both tables.

## Failure outcomes

| Case                          | Behavior                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Machine offline               | Browse is disabled at the call sites by `isMachineConnected`                             |
| Daemon dies mid-session       | Row stays `pending`; the UI shows `no-response` after 15 s with Retry                    |
| Old CLI without the fulfiller | Same `no-response` state                                                                 |
| Daemon restart                | The subscription re-delivers pending rows; no daemon state to recover                    |
| Expired session               | Mutations throw `FOLDER_BROWSE_EXPIRED`; `get` still returns the row until the cron runs |
| Stale result                  | Ignored by the `navSeq` check                                                            |
| Permission denied             | `state: error`, `PERMISSION_DENIED`; the previous listing stays visible                  |
| Path disappeared              | The daemon falls back to the nearest existing ancestor and echoes `requestedPath`        |
| Enormous directory            | Scan cap, time budget, `truncated` / `complete`, daemon-side filter                      |
| Slow or hung mount            | 10 s hard timeout gives `TIMEOUT`                                                        |
| Repeated navigation           | Identical pending navigation is a no-op; filter debounced; latest wins                   |

## Non-goals

File selection, previews, multi-select, bookmarks, Windows paths, tree push, and per-directory
subscriptions. No native dialog is opened: `daemon.pickFolder` is a retired no-op that logs and
acknowledges, and nothing in the webapp or the daemon opens a dialog.
