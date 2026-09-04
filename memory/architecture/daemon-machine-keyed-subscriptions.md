---
type: tech-debt
title: Daemon machine-keyed subscriptions
description: Research log of daemon WebSocket subscriptions keyed on machineId whose natural scope is chatroom or workspace.
tags: [daemon, subscriptions, convex, bandwidth, machine-id, chatroom, workspace]
status: active
last_reviewed: 2026-09-05
---

# Daemon subscriptions keyed on machine id

Research log (2026-09-05): which WebSocket subscriptions the daemon keeps keyed on `machineId`, and which should be re-scoped to chatroom or workspace level. Same class of change as PR #1603 (operational signals → chatroom) and PR #1610 (enhancer jobs → chatroom).

## Inventory

The daemon subscribes via `wsClient.onUpdate(...)` in the v2 subscriber set (`packages/cli/src/daemon/infrastructure/convex/subscribers/`, wired by `entry/subscriber-registry.ts`), plus the task inbox (`infrastructure/inbox/task.ts`), operational inbox (`infrastructure/agent-operational/operational-inbox.ts`), log-observer subscription (`entry/handlers/process/log-observer-subscription.ts`), and per-job enhancer outcome (`entry/enhancer/job-outcome-subscription.ts`).

| Subscriber (CLI)               | Convex query                                         | Args key                                | Backing table                                                 | Recommended scope                                                                        |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `machine-command-inbox.ts`     | `daemon.machineCommandInbox.watchNext`               | `machineId`                             | `chatroom_machineCommandInbox`                                | machine (correct — commands are addressed to the machine; returns single `commandId`)    |
| `command-run.ts`               | `daemon.commands.listActionableCommandRuns`          | `machineId`                             | `chatroom_commandRunsV2`                                      | workspace/chatroom (rows keyed `machineId` + `workingDir`)                               |
| `git-request.ts`               | `workspaces.getPendingRequests`                      | `machineId`                             | `chatroom_workspaceDiffRequests`                              | workspace (per `workingDir`)                                                             |
| `file-tree-request.ts`         | `workspaceFiles.getPendingFileTreeRequests`          | `machineId`                             | `chatroom_workspaceFileTreeRequests`                          | workspace (per `workingDir`)                                                             |
| `file-tree-release-request.ts` | `workspaceFiles.subscribeMachineFileTreeReleaseHead` | `machineId`                             | `chatroom_machineFileTreeReleaseHeads`                        | workspace or machine (compact single-revision aggregate — low priority)                  |
| `file-content-request.ts`      | `workspaceFiles.getPendingFileContentRequests`       | `machineId`                             | `chatroom_workspaceFileContentRequests`                       | workspace (per `workingDir`)                                                             |
| `file-write-request.ts`        | `workspaceFiles.getPendingFileWriteRequests`         | `machineId`                             | `chatroom_workspaceFileWriteRequests`                         | workspace (per `workingDir`)                                                             |
| `agentic-query-session.ts`     | `daemon.agenticQuery.runs.pendingForMachine`         | `machineId`                             | `chatroom_agenticQueryRuns` (indexed `by_workspace_status`)   | chatroom (rows resolve to `chatroomId`)                                                  |
| `agentic-query-prompt.ts`      | `daemon.agenticQuery.messages.pendingForMachine`     | `machineId`                             | `chatroom_agenticQueryRuns` + `chatroom_agenticQueryRunTurns` | chatroom (rows resolve to `chatroomId`)                                                  |
| `task.ts` (inbox)              | `messageList.subscribeTaskStatusSignalsSince`        | `machineId` + `afterKey`                | `chatroom_machineTaskStatusSignals`                           | chatroom (in-flight on sibling branch `refactor/scope-task-status-signals-per-chatroom`) |
| `operational-inbox.ts`         | `machines.subscribeMachineOperationalSignalsSince`   | `machineId` + `chatroomId` + `afterKey` | `chatroom_machineOperationalSignals`                          | done — chatroom (PR #1603)                                                               |
| `log-observer-subscription.ts` | `daemon.commands.listRunsWithLogObservers`           | `machineId`                             | `chatroom_commandRunsV2`                                      | workspace (per `workingDir`)                                                             |
| `enhancer-job.ts`              | `daemon.enhancer.index.pendingForChatroom`           | `machineId` + `chatroomId`              | `chatroom_enhancerJobs`                                       | done — chatroom (PR #1610)                                                               |
| `job-outcome-subscription.ts`  | `web.enhancer.index.getJobOutcome`                   | `chatroomId` + `jobId`                  | enhancer job row                                              | correct — per job (already job-scoped)                                                   |

## Candidates for re-scoping (machineId → chatroom/workspace)

Queued-work feeds keyed on `machineId` whose rows are actually per-`workingDir` (workspace-scoped):

- `api.workspaces.getPendingRequests` (git diff/commit requests)
- `api.workspaceFiles.getPendingFileTreeRequests`
- `api.workspaceFiles.getPendingFileContentRequests`
- `api.workspaceFiles.getPendingFileWriteRequests`
- `api.daemon.commands.listActionableCommandRuns` (runs carry `workingDir`)
- `api.daemon.commands.listRunsWithLogObservers` (runs carry `workingDir`)

Machine-wide feeds whose rows already carry `chatroomId` (natural chatroom scope):

- `api.daemon.agenticQuery.runs.pendingForMachine` (per-workspace scan; projects `chatroomId`)
- `api.daemon.agenticQuery.messages.pendingForMachine` (same projection)
- `api.messageList.subscribeTaskStatusSignalsSince` (signals carry `chatroomId`; sibling branch `refactor/scope-task-status-signals-per-chatroom` already scopes this per chatroom)

## Correctly machine-scoped (do not change)

- `api.daemon.machineCommandInbox.watchNext` — commands are addressed to the machine itself; payload is a single `commandId` wake-up nudge.

## Imperative (not subscribed reactively)

- `api.workspaces.listWorkspacesForMachine` — one-shot discovery used by the enhancer subscriber to reconcile per-chatroom watches.
- `api.machines.listOperationalStatusForMachineSignalRange` — hydration after a chatroom-scoped signal page.

## Related

- `/architecture/bandwidth-at-rest-scaling.md` — same bandwidth-at-rest concern (machine-keyed feeds scale with all projects on a machine).
- PR #1603 (operational signals → chatroom), PR #1610 (enhancer jobs → chatroom).
