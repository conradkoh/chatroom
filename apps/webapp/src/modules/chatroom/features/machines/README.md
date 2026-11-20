# machines feature

The `/app/machines` tab: every computer that has registered a daemon for the current account,
with live connectivity, usage counts, harness chips, an inline alias editor, owner-only deletion
and an expandable body whose first section manages project roots. The route itself is a thin
wrapper at [`apps/webapp/src/app/app/machines/page.tsx`](../../../../app/app/machines/page.tsx)
around `MachinesPage`.

The section strip (`Chatrooms | Machines`) is shared with the chatroom list and lives at
`apps/webapp/src/modules/chatroom/components/AppSectionTabs.tsx`.

## Layout

| Path                                 | Role                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `MachinesPage.tsx`                   | Page shell: section strip, heading, error boundary around the querying content.                                |
| `components/MachineList.tsx`         | Ordered card list. Order comes from `useMachineRows`.                                                          |
| `components/MachineCard.tsx`         | One machine: status dot, alias field, status line, usage, harness chips, actions menu and the expandable body. |
| `components/MachineHarnessChips.tsx` | Per-card harness chips from `useMachineCapabilities`.                                                          |
| `components/MachineProjectRoots.tsx` | Expanded card's first section: roots list, add form, offline/limit notes.                                      |
| `components/AddProjectRootForm.tsx`  | Typed or Browse-picked path field, add state, error and success notes.                                         |
| `components/ProjectRootRow.tsx`      | One root path with a remove button and an inline retry error.                                                  |
| `components/MachineActionsMenu.tsx`  | Descriptor-driven card menu. Safe actions first, destructive actions after a separator.                        |
| `components/machineActions.ts`       | `MachineAction` descriptor type and `buildMachineActions` (the extension point).                               |
| `components/DeleteMachineDialog.tsx` | Blocked and confirm variants for deletion, with the live online→offline flip.                                  |
| `components/MachineAliasField.tsx`   | Inline alias editor shared with `AgentSettingsModal`.                                                          |
| `components/MachinesStates.tsx`      | Loading skeletons, empty state with the daemon start command, and the error-boundary fallback.                 |
| `hooks/useMachineRows.ts`            | Joins the registry with connectivity, last-seen and usage into row models.                                     |
| `lib/machineDisplay.ts`              | Pure display helpers: OS label, relative last seen, registered date, usage summary and registry-only sorting.  |
| `lib/machineErrorCopy.ts`            | Maps `ConvexError.data.code` and payload messages to user-facing copy.                                         |

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
- Browse reuses `useSetupWorkspaceFolderPicker` and only fills the input. Adding is always the user's
  explicit action (`Add root` or Enter in the field).
- Backend errors are mapped in `lib/machineErrorCopy.ts`; unknown failures use the fallback copy. A
  typed value is kept on error and the input is marked `aria-invalid`.
- `add` returns `collapsedPaths` when the new root replaces children; the success note names them
  (`Replaced N nested root(s): …`). `remove` returning `removed: false` is a success (already gone).

The Repositories section is not built yet (package 3).

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
| `MACHINE_NOT_FOUND` | Closes the dialog and shows a toast.                               |
| anything else       | Keeps the dialog open with inline copy from `machineErrorCopy.ts`. |

Backend invariants (tombstone-first deletion, the `MACHINE_SCOPED_TABLES` registry rule, purge
batches and retention) are documented in
[memory/architecture/machine-management.md](../../../../../../../memory/architecture/machine-management.md)
and [docs/cleanup-policies.md](../../../../../../../docs/cleanup-policies.md).

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

## Not here yet

The Repositories section (on-demand ledger snapshot, bulk chatroom creation) and daemon updates are
later packages.
