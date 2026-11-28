# Switch workspace

Move a chatroom from one machine + folder to another. The user confirms the consequences, and the
result screen reports exactly what happened. The backend contract is
`workspaces.switchWorkspace` (`services/backend/convex/workspaces.ts`), delivered separately.

## Stages

`useSwitchWorkspaceFlow.ts` is the one stage machine, shared by the dialog and the setup checklist:

- `choose` — `SwitchWorkspaceChooseStep.tsx`. Reuses the setup chooser (`SetupMachineSection`,
  `SetupFolderPickerField`, `useSetupWorkspaceFolderPicker`). Offline machines are labelled but
  selectable; Browse needs the daemon, so it is disabled for them while the typed path stays usable.
  Browse opens the inline remote browser under the field, and Select fills the typed path.
  The primary button is "Review switch", never the destructive action.
- `review` — `SwitchWorkspaceReviewStep.tsx`. From/To, the five consequence lines
  (`CONSEQUENCES`), the "Expected" carry-over preview (`lib/carryOverPreview.ts`), and an
  acknowledgement checkbox. Confirm stays disabled until it is ticked.
- `submitting` — the same screen with the confirm labelled `Switching…`; Back, the checkbox and the
  close affordances are disabled, and Escape/backdrop do not close.
- `done` — `SwitchWorkspaceResultStep.tsx`. `switched` reports the stop line derived from
  `agentsStopRequested` (no count exists), that agents were not started, carried-over roles, and
  skipped roles with their reason (`lib/switchWorkspaceCopy.ts`). `unchanged` reports
  "Nothing changed".

## Conflict rule

At Review, the flow freezes the current workspace registry id in `from.registryId`. `submit()` reads
the live id from the context and refuses to call the mutation when they differ; the Review stage
then shows the conflict panel (`switch-conflict`). `WORKSPACE_SWITCH_CONFLICT` and
`WORKSPACE_ALREADY_BOUND` from the backend map to the same panel and change nothing.
`INVALID_WORKING_DIR` returns to Choose with the path marked invalid; machine and generic errors stay
inline on Review with confirm still available.

## Entry points

- Desktop: the `Switch workspace…` item at the end of the workspace `DropdownMenu` in
  `workspace/components/WorkspaceBottomBar.tsx` (`switch-workspace-action`).
- Mobile: the last row of `MobileWorkspaceModal` in the same file
  (`switch-workspace-action-mobile`).
- Both mount `SwitchWorkspaceDialog.tsx`; closing it returns focus to the trigger that is mounted for
  the current breakpoint.

## Checklist routing

`components/SetupChecklistModal.tsx` renders the embedded `SwitchWorkspaceFlow` on the workspace
step whenever an active workspace exists, so Back from the agent step switches instead of
registering. `registerWorkspace` is only reached when no workspace exists. The re-route effect
depends on primitive machine/folder values and is guarded while a switch is submitting or showing
its result, so a finished switch does not force the agent step over the Result screen.

## Tests

- `lib/switchWorkspaceCopy.test.ts`, `lib/carryOverPreview.test.ts` — pure copy and derivation.
- `useSwitchWorkspaceFlow.test.ts` — stages, acknowledgement gate, conflict and error classification.
- `SwitchWorkspaceDialog.test.tsx` — the rendered dialog with the Convex-backed hooks as ports.
