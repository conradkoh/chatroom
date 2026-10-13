# new-chatroom feature

The wizard that creates a chatroom on a machine and a folder. It opens from the chatroom selector.
Each step is one component. The clone flow is driven by a daemon request, and the setup steps use
the shared setup standard in [components/setup/README.md](../../components/setup/README.md).

## Steps

The wizard keeps the current step in `NewChatroomWizard.tsx` (`WizardStep`: `machine`, `workspace`,
`agents`).

| Step         | Component                      | What it does                                                                                                                                                           |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Machine   | `NewChatroomMachineStep.tsx`   | Picks a connected machine. Continue is enabled only for a connected machine. The default is chosen by `pickDefaultMachineId`.                                          |
| 2. Workspace | `NewChatroomWorkspaceStep.tsx` | Chooses the folder. The Clone tab is `CloneRepoForm.tsx`, and the Existing folder tab is `ExistingFolderForm.tsx`. Back returns to step 1 and clears the create error. |
| 3. Agents    | `NewChatroomAgentsStep.tsx`    | Starts the team's agents on the new chatroom through `SetupAgentTeamStep`. The only exit is "Open chatroom". Cancel is not offered.                                    |

Escape on step 1 cancels the wizard. Escape on step 2 follows the leave guard below. Escape is
ignored on step 3.

## Single creation path

Only `NewChatroomWizard.tsx` creates a chatroom, through `api.chatrooms.createWithWorkspace`. Its
`createFromFolder` function is the `onWorkspaceReady` callback given to step 2.

- A synchronous `creatingRef` guard stops a second create while one is in flight.
- On success the wizard records the created chatroom and moves to step 3.
- On failure it keeps the user on step 2 and shows the message.

`onWorkspaceReady` is called from three places:

- `ExistingFolderForm.tsx`, when the user submits a folder.
- `CloneRepoForm.tsx`, once per completed clone, from `useCloneCompletionHandoff`.
- `CloneRepoForm.tsx`, from the retry button after a failed create (see below).

## Clone flow

`hooks/useGitCloneRequest.ts` calls `api.gitCloneRequests.request` to queue the clone. It then
follows the request with a reactive `api.gitCloneRequests.get` query, keyed by request id. A start
that fails before a request exists shows the `failed` state with the `invalid_request` message.

The view state is derived on the client by `lib/deriveGitCloneViewState.ts` from the request row,
the clock, and whether the machine is connected. The backend stores only the status, progress, and
timestamps.

| State       | When it applies                                                                     | What the form shows                                                                      |
| ----------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `idle`      | No clone has been requested.                                                        | The form, ready to start.                                                                |
| `waiting`   | The request row is still loading, or its status is `pending`.                       | Waiting for the daemon. Shows that the machine appears offline when it is not connected. |
| `timed_out` | Still `pending` more than `GIT_CLONE_PICKUP_TIMEOUT_MS` (5 minutes) after creation. | The daemon did not pick up the request. Retry resets the clone.                          |
| `cloning`   | The status is `cloning`.                                                            | The progress phase and percent.                                                          |
| `stalled`   | `cloning`, with no update for more than `GIT_CLONE_STALL_MS` (2 minutes).           | The clone has stopped reporting progress.                                                |
| `completed` | The status is `completed`.                                                          | The cloned path. The path is handed to the wizard once.                                  |
| `failed`    | The status is `failed`, or the request row is missing or not visible.               | The error message for its code. A missing row shows the `unknown` code.                  |

The 5-minute pickup timeout matches the delivery window of the `daemon.gitClone` machine command
(`MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS`, in `services/backend/config/reliability.ts`). The clone
itself is not bounded by that window.

## Retry after a failed create

A clone can complete and the chatroom create can still fail. The clone is kept, and its state stays
`completed`.

- `CloneRepoForm.tsx` shows the create error with the clone kept, and tells the user to select
  Create chatroom to try again.
- The primary button becomes Create chatroom. It calls the same `onWorkspaceReady` with the cloned
  path, so the retry goes through the single creation path.
- For a completed clone the step-level create error stays hidden (`showsTopCreateError` in
  `NewChatroomWorkspaceStep.tsx`).

## Leave guard

`hooks/useWorkspaceEscape.ts` runs on step 2. Escape cancels the wizard at once, unless the clone
state needs a confirm.

| Clone state                     | Escape                                               |
| ------------------------------- | ---------------------------------------------------- |
| `waiting`, `cloning`, `stalled` | Opens `CloneLeaveDialog` with the `running` guard.   |
| `completed`                     | Opens `CloneLeaveDialog` with the `completed` guard. |
| `idle`, `failed`, `timed_out`   | Cancels at once.                                     |

Escape does nothing while a chatroom create is in flight. The dialog's Keep action closes it. Its
Leave action cancels the wizard.

## Layout

| Path                                                           | Role                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `NewChatroomWizard.tsx`                                        | Step state, the single creation path, Escape on step 1.                   |
| `NewChatroomMachineStep.tsx`                                   | Step 1.                                                                   |
| `NewChatroomWorkspaceStep.tsx`                                 | Step 2: the Clone and Existing folder tabs, and the leave confirm.        |
| `CloneRepoForm.tsx`, `CloneFields.tsx`, `CloneStatusPanel.tsx` | The clone form and its status.                                            |
| `CloneLeaveDialog.tsx`                                         | The leave confirm for a clone that is still running or already completed. |
| `ExistingFolderForm.tsx`                                       | The folder picker form for a folder that already exists.                  |
| `NewChatroomAgentsStep.tsx`                                    | Step 3.                                                                   |
| `hooks/`                                                       | `useCloneTarget`, `useGitCloneRequest`, `useWorkspaceEscape`.             |
| `lib/`                                                         | `deriveGitCloneViewState.ts`, the pure clone state rule.                  |

The setup shell, footer and folder field used by these steps are described in
[components/setup/README.md](../../components/setup/README.md).
