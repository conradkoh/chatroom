# Setup steps

The shared standard for setup steps: the machine, workspace, and agent steps used by the new
chatroom wizard and by the setup checklist modal. The code is in this folder unless a link says
otherwise.

## Shell and footer

- Every step renders `SetupStepLayout` (`SetupStepLayout.tsx`), directly or through its form. The
  layout is a scrolling body with the footer pinned below it. The workspace step has no layout of its
  own: its Clone and Existing folder forms each render one.
- A step with actions passes a `SetupStepFooter` as `footer`. A step with no action passes none.
  `SetupAgentTeamStep.tsx` omits the footer once every agent has joined and no secondary action is
  given.
- `SetupStepFooter` puts the secondary action on the left and the primary action on the right. On
  mobile the two share the width.
- Use the exported classes for every action. `setupPrimaryButtonClassName` is the primary action,
  and `setupSecondaryButtonClassName` is Back, Cancel, or the secondary action. Do not write button
  classes inline.

## Focus

`SetupStepLayout` takes `autoFocusFirstControl`, which is required. When it is `true`, the layout
focuses the first enabled input or button in the body on mount. Callers that want focus pass `true`:
`NewChatroomMachineStep`, `ExistingFolderForm`, `CloneRepoForm`, and the agent step rendered by
`NewChatroomAgentsStep`. The workspace step and the checklist modal's agent step pass `false`, since
neither focused before.

## Loading, empty, offline and error states

| State                 | How it is shown                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Loading               | `SetupWorkspaceLoadingPanel`. Used by the machine step, the workspace step, and the agents step.                                 |
| No prerequisites met  | `SetupWorkspacePrerequisitesPanel`, inside `SetupMachineSection`. The workspace step also shows it while machines are connected. |
| No machine registered | The "No machines are registered yet" line in `SetupMachineSection`.                                                              |
| Offline machine       | `SetupMachinePicker` lists it dimmed, with an "Offline" label, and it cannot be picked.                                          |
| Error                 | An inline paragraph in the step with the status error style. These are not a shared panel.                                       |

## Machine rules

- A machine counts as connected through `useConnectedMachines`
  (`apps/webapp/src/hooks/useConnectedMachines.ts`). Use it, rather than filtering connectivity by
  hand.
- `pickDefaultMachineId.ts` is the one default rule: a chosen machine wins, otherwise the only
  connected machine is chosen. The workspace step keeps a chosen machine once it is set, even when
  another machine connects.

## Folder field

`SetupFolderPickerField.tsx` is the one folder-path field. It takes these props:

| Prop                | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `variant`           | `'setup'` or `'clone'`. Chooses the heading style and the status order.  |
| `heading`           | The visible heading.                                                     |
| `inputAriaLabel`    | The text input's accessible name.                                        |
| `waitingText`       | The line shown while the picker waits for the daemon.                    |
| `value`, `onChange` | The path text.                                                           |
| `placeholder`       | The input placeholder.                                                   |
| `inputDisabled`     | Disables only the text input.                                            |
| `browseDisabled`    | Disables only the Browse button. A typed path stays editable.            |
| `picker`            | The `FolderPickerState` from `useSetupWorkspaceFolderPicker.ts`.         |
| `hint`              | Optional content under the input row, for example the clone target hint. |

The `picker` state shows three things. While a pick is pending it shows `waitingText`. After a timeout
it shows the timeout hint and the retry prompt. Otherwise it shows the picker's error.

- `variant: 'setup'` uses the wizard heading style. The status sits below the Browse row, with the
  retry prompt before the error line.
- `variant: 'clone'` uses the clone form's smaller heading. The error line sits above the retry
  prompt.

Browse is disabled while a pick is pending. Each caller decides whether the text input is also
disabled, through `inputDisabled`.

## Consumers

- `SetupChecklistModal.tsx` renders `SetupWorkspaceStep.tsx` and `SetupAgentTeamStep.tsx`.
- The new chatroom wizard renders its machine, workspace and agent steps from
  `../../features/new-chatroom/`. Its own rules are in
  [the feature README](../../features/new-chatroom/README.md).
