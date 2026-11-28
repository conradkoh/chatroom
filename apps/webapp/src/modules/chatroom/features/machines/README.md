# machines feature

The `/app/machines` tab: every computer that has registered a daemon for the current account,
with live connectivity, usage counts, harness chips, an inline alias editor, owner-only deletion
and an expandable body whose first section manages project roots. The route itself is a thin
wrapper at [`apps/webapp/src/app/app/machines/page.tsx`](../../../../app/app/machines/page.tsx)
around `MachinesPage`.

The section strip (`Chatrooms | Machines`) is shared with the chatroom list and lives at
`apps/webapp/src/modules/chatroom/components/AppSectionTabs.tsx`.

## Layout

| Path                                                    | Role                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MachinesPage.tsx`                                      | Page shell: section strip, heading, error boundary around the querying content.                                           |
| `components/MachineList.tsx`                            | Ordered card list. Order comes from `useMachineRows`.                                                                     |
| `components/MachineCard.tsx`                            | One machine: status dot, alias field, status line, usage, harness chips, actions menu and the expandable body.            |
| `components/MachineHarnessChips.tsx`                    | Per-card harness chips from `useMachineCapabilities`.                                                                     |
| `components/MachineProjectRoots.tsx`                    | Expanded card's first section: roots list, add form, offline/limit notes.                                                 |
| `components/AddProjectRootForm.tsx`                     | Typed path field with the inline remote browser, add state, error and success notes.                                      |
| `components/ProjectRootRow.tsx`                         | One root path with a remove button and an inline retry error.                                                             |
| `components/MachineRepositories.tsx`                    | Expanded card's second section: snapshot states, filter, virtualised rows and the bulk-create dialog.                     |
| `components/RepositoryBanners.tsx`                      | Snapshot warning banners: truncated, root issues, changed roots, offline and omitted entries.                             |
| `components/RepositoryRow.tsx`                          | One 72 px repository row: name, branch, path, status badge and open/create action.                                        |
| `components/RepositoryFilterBar.tsx`                    | Filter input for the loaded snapshot; Escape or the clear button empties it.                                              |
| `components/BulkCreateButton.tsx`                       | Bulk trigger for the visible no-chatroom rows, or the done line when every shown row has a chatroom.                      |
| `components/BulkCreateDialog.tsx`                       | Confirm, pending, summary and error phases for one bulk-create session, walking batches of 50.                            |
| `components/LedgerNotice.tsx`                           | Warning/error callout shared by ledger failures and snapshot banners.                                                     |
| `components/MachineActionsMenu.tsx`                     | Descriptor-driven card menu. Safe actions first, destructive actions after a separator.                                   |
| `components/machineActions.ts`                          | `MachineAction` descriptor type and `buildMachineActions` (descriptor ids: `rename, export, import, delete`).             |
| `components/DeleteMachineDialog.tsx`                    | Blocked and confirm variants for deletion, with the live online→offline flip.                                             |
| `../transfer/components/ImportDialog.tsx`               | Import dialog mounted by the card.                                                                                        |
| `../transfer/components/import/ImportTargetMachine.tsx` | Locked target strip shown on every import step.                                                                           |
| `components/MachineAliasField.tsx`                      | Inline alias editor shared with `AgentSettingsModal`.                                                                     |
| `components/MachinesStates.tsx`                         | Loading skeletons, empty state with the daemon start command, and the error-boundary fallback.                            |
| `hooks/useMachineRows.ts`                               | Joins the registry with connectivity, last-seen and usage into row models.                                                |
| `hooks/useRepositoryLedger.ts`                          | Owns the on-demand snapshot lifecycle and its view states; discards only the requests it created, on collapse or unmount. |
| `hooks/useBulkCreateChatrooms.ts`                       | Calls `chatrooms.createManyWithWorkspace`; `createOne` is the same call with one directory.                               |
| `lib/machineDisplay.ts`                                 | Pure display helpers: OS label, relative last seen, registered date, usage summary and registry-only sorting.             |
| `lib/machineErrorCopy.ts`                               | Maps `ConvexError.data.code` and payload messages to user-facing copy.                                                    |
| `lib/bulkCreate.ts`                                     | Batch planning, running totals, button-disabled reasons and count copy for bulk create.                                   |
| `lib/repositoryFilter.ts`                               | Case-insensitive name/path/branch filter over the loaded entries, in list order.                                          |

Shared hooks in `apps/webapp/src/hooks/`:

| Hook                     | Query                                 | Used for                                                     |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| `useUserMachines`        | `machines.getUserMachines`            | Cold registry (metadata only); the page-level loading state. |
| `useDaemonConnectivity`  | `machines.listMachineConnectivity`    | Hot online/offline per machine.                              |
| `useMachineUsage`        | `machines.getMachineUsage`            | Active workspace / chatroom counts.                          |
| `useMachineLastSeen`     | `machines.listMachineLastSeen`        | Offline last-seen timestamps.                                |
| `useMachineCapabilities` | `machines.getMachineCapabilities`     | Harness chips for one card.                                  |
| `useMachineProjectRoots` | `machineProjectRoots.list/add/remove` | Roots for one machine plus the add/remove mutations.         |
| `useDeleteMachine`       | `machines.deleteMachine`              | Owner-only, offline-only deletion mutation.                  |

## Cold and hot queries

The page deliberately splits the registry from live daemon state:

- The registry (`useUserMachines` → `machines.getUserMachines`) reads only
  `chatroom_machines`. Its subscription invalidates on register, rename and delete, not on every
  heartbeat.
- Connectivity, last seen, usage and capabilities are separate narrow queries. Each field
  degrades on its own row while it loads.
- Card ordering depends only on registry fields (display name, then `registeredAt`, then
  `machineId`) via `sortMachinesByDisplayName`, so heartbeats never reshuffle cards.
- `connected === undefined` renders `Checking…` and is treated as "not yet known": it never
  enables the delete action. Only the registry query drives the page-level loading state.

## Harness chips

`MachineHarnessChips` calls `useMachineCapabilities(machineId)` once per card. There is no batch
capabilities query. Offline machines keep their last reported chips, dimmed and annotated as
"Last reported by the daemon". A machine with no reported harnesses renders nothing.

## Project roots

`MachineCard` is an expander: the page owns `expandedMachineId` (single-expand accordion), and the
card body — the `Project roots` section — mounts only while that card is expanded. Collapsed cards
therefore hold no `machineProjectRoots.list` subscription.

- The section shows loading skeletons, the empty copy, the populated list with an `n / 20` counter
  (`MAX_PROJECT_ROOTS` from `@workspace/backend/src/domain/entities/project-root`), an offline
  callout, and the limit note.
- Adding needs the machine online: offline disables the input, Browse and `Add root`. Removing works
  offline; a removal never deletes chatrooms or files on the machine, so there is no confirmation.
- Browse reuses `useSetupWorkspaceFolderPicker` and renders the inline remote browser under the
  field; Select only fills the input. Adding is always the user's explicit action (`Add root` or
  Enter in the field).
- Backend errors are mapped in `lib/machineErrorCopy.ts`; unknown failures use the fallback copy. A
  typed value is kept on error and the input is marked `aria-invalid`.
- `add` returns `collapsedPaths` when the new root replaces children; the success note names them
  (`Replaced N nested root(s): …`). `remove` returning `removed: false` is a success (already gone).

## Repositories

`MachineCard` mounts `MachineRepositories` in the same expanded body as project roots, after
`MachineProjectRoots`, so a collapsed card loads nothing. The section is not kept in sync: it asks
the machine's daemon for a snapshot when the user asks, and shows that list until it is discarded.

`useRepositoryLedger(machineId, { connected, hasRoots })` owns the snapshot lifecycle. Its view
kind is `idle`, `asking`, `ready`, `timedOut` or `failed`. The snapshot is discarded when the
section unmounts (collapse or navigation); the hook calls `repositoryLedger.discard` for the
pending ask and the displayed snapshot.

`idle` copy checks the blocking condition first:

- Offline: `Machine is offline. Start the daemon to load repositories.`
- No roots: `Add a project root above, then load repositories.`
- Expired: `That snapshot expired. Load it again.`
- Otherwise: `Repositories are read from this machine's daemon when you ask. The list is a snapshot, not kept in sync.`
- `Load repositories` is disabled unless `canRequest`, which needs the machine online and at least
  one root.

`asking` shows `Asking daemon…` with a `Cancel` button. When a snapshot already exists it stays
visible and `Rescan` reads `Asking daemon…`.

`ready` headers the list with `Snapshot from <relative time> · <N repositories> · not kept in sync`
and a `Rescan` button (`ledger-rescan`), disabled unless the machine is online.

- Empty: `No git repositories found under your project roots.` plus `Rescan`.
- Pages still loading: `Loading repositories… <loaded> of <total>`.
- No match: `No repositories match “<filter>”.` plus `Clear filter`.
- A failed rescan keeps the previous list and shows a notice: the timed-out copy, or
  `Rescan failed: <message>. The previous list is still shown.`

`timedOut` shows `The daemon did not respond. It may need updating, or it went offline.` with
`Try again`. `failed` shows `Could not read repositories: <message>` with `Try again`.

`RepositoryBanners` renders the warning notices in order: truncated at the 1,000-entry cap, roots
missing, roots unreadable, roots changed since the snapshot (`Rescan to refresh`), machine offline
(`This snapshot may be out of date`), and omitted entries (invalid, over-long or duplicate paths).
Banners and failure notices share the `LedgerNotice` callout.

`RepositoryRow` is a fixed 72 px row: name, branch (or `no branch`), and the path with its root
prefix dimmed. The status badge is `Has chatroom` or `No chatroom`; the action is `Open` (links to
the chatroom) or `Create chatroom` (`Creating…` while pending), disabled unless the machine is
confirmed online. `RepositoryFilterBar` filters the loaded entries through `filterRepositories`
(`lib/repositoryFilter.ts`) on name, path and branch.

Bulk create uses the same creation path as the single-row action: both go through
`useBulkCreateChatrooms`, which calls `chatrooms.createManyWithWorkspace`; `createOne` passes a
one-element array. The button targets the visible rows without a chatroom and reads `Create
chatrooms for N repositories`, or `Every repository shown has a chatroom.` when there are none. It
is disabled with `Machine is offline`, `Checking machine…` or `Loading repositories…` from
`bulkCreateDisabledReason` (`lib/bulkCreate.ts`), and spans the section below `sm`.

`BulkCreateDialog` walks the targets in batches of `BULK_CREATE_MAX_REPOSITORIES` (50) through
`planBulkCreate`: confirm (`Create chatrooms for N repositories?`, with an over-limit note),
pending (`Creating chatrooms…`), summary (`Created · Skipped · Failed`, the skipped line, `N
repositories still have no chatroom.`, `Done`, and a next-batch button while work remains) and
error (`Could not create chatrooms`, `Close`, `Try again`), with failures listed under `Failed
(N)`. The cumulative summary stays inline and closes only on `Done`.
Repositories that already have a chatroom are skipped and no agent is started. The UI disables
create while the machine is offline; the backend itself does not require it. On mobile the dialog
stays inside the viewport and rows keep their fixed height, truncating text.

## Delete flow

Deletion is owner-only and offline-only.

| Dialog variant | When                                                                          | Action                                                                 |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Blocked        | `connected === true`, or the server rejects with `MACHINE_ONLINE`.            | Explains the guard and offers the stop command; no destructive button. |
| Confirm        | Connectivity is known-offline and a retryable error (if any) is shown inline. | `Delete machine`, enabled only once usage has loaded (see the guard).  |

The confirm action is guarded by `connected === false && usage !== undefined && !pending`, so an
unknown or loading connectivity can never delete. The server stays authoritative: `deleteMachine`
re-checks ownership and offline status. `DeleteMachineDialog` maps the failures:

| Error code          | UI                                                                 |
| ------------------- | ------------------------------------------------------------------ |
| `MACHINE_ONLINE`    | Switches the open dialog to the blocked variant.                   |
| `MACHINE_NOT_FOUND` | Keeps the dialog open with inline copy from `machineErrorCopy.ts`. |
| anything else       | Keeps the dialog open with inline copy from `machineErrorCopy.ts`. |

Backend invariants (tombstone-first deletion, the `MACHINE_SCOPED_TABLES` registry rule, purge
batches and retention) are documented in
[memory/architecture/machine-management.md](../../../../../../../memory/architecture/machine-management.md)
and [docs/cleanup-policies.md](../../../../../../../docs/cleanup-policies.md).

## Import

- The **Import chatrooms…** item sits between Export and Delete (`machine-action-import`). It is never disabled, so it works for online, offline and still-checking machines.
- `MachineCard` owns `ImportDialog` the way it owns `DeleteMachineDialog`: mounted only while open, outside `MachineCardBody` so collapsing the card cannot unmount it mid-flow, with `finalFocusRef={menuTriggerRef}`. The dialog is locked to the card's machine and shows the `import-target` strip on every step.
- `InterruptedImportNotice` is mounted at page level, above the list and outside the error boundary, so it shows in loading, empty and error states. It names no machine: the stored record has none.
- `MachinesEmptyState` carries one hint line (`machines-empty-import-hint`) that points to the card menu.

## Action-area extension point

`machineActions.ts` defines `MachineAction` (`id`, `label`, `icon`, optional `destructive`,
`onSelect`) and `buildMachineActions`. Adding a machine-level action such as "Update daemon" is
one more `id` in the union plus one descriptor entry: `MachineActionsMenu` renders whatever it is
given, with no layout change. New actions must reuse the backend invariants above.

## Single alias editor

`MachineAliasField` is the one inline editor, shared with `AgentSettingsModal`. Keyboard contract:
Enter saves, Escape cancels, and blur does nothing, so a stray click cannot save or discard a
rename. An empty value clears the alias.

## Error copy

Keep machine mutation copy in `lib/machineErrorCopy.ts`. Extend its `MACHINE_ERROR_COPY` table for
new backend codes instead of scattering strings across components.

## Backups

`MachineBackups` sits below the repository ledger in the expanded card. Inventory is on demand:
nothing is subscribed or requested until the user presses **Check backups**, and the section only
mounts while the card is expanded. A download is an ephemeral warned copy — Requested → Preparing
→ Ready → Downloading → Done — whose short-lived URL exists only inside the save call, and whose
cloud copy is deleted when `writeDownloadConfirmation` records receipt. Copy and failure mappings
live in `lib/backupCopy.ts`.

## Not here yet

Daemon updates are later packages.

## Known debt

- `components/DeleteMachineDialog.tsx` keeps a `fallow-ignore-next-line complexity` on its 68-line dialog function. The suppression predates this change. Split the function into its blocked and confirm variants in a follow-up.
