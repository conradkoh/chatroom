---
type: tech-debt
title: Bandwidth at rest across projects
description: Cross-app audit of Convex subscriptions and heartbeat paths when a machine has many projects but only one or two active agents.
tags: [bandwidth, convex, daemon, subscriptions, projects, performance]
status: active
last_reviewed: 2026-08-31
---

# Bandwidth at rest across projects

## Executive summary

The current system has a meaningful project-count-dependent bandwidth baseline even when only one or two projects have active agents. The dominant risks are:

1. The daemon subscribes to recently observed workspaces using a seven-day window, rather than to only currently active projects.
2. The daemon subscribes to every operational-status row for a machine, including inactive project/role rows.
3. The web app keeps global subscriptions for all of the user's chatrooms, including a global per-role status read model.

The task-signal and command-inbox subscriptions are comparatively well-shaped for idle operation: they are cursor- or event-oriented and return empty results when there is no work.

This assessment combines repository inspection with a bandwidth screenshot supplied on 2026-08-28. The screenshot is an aggregate by Convex function; it does not establish the exact idle transfer rate or distinguish response bytes from other Convex bandwidth accounting. The scaling conclusions below are based on query scope, returned shape, and invalidation dependencies in the code.

## Status overview

Track remediation progress here. Update status and PR links as work lands.

| Status   | Meaning                                        |
| -------- | ---------------------------------------------- |
| `open`   | Identified; not yet completed                  |
| `closed` | Won't pursue or superseded by another approach |
| `done`   | Remediated and verified                        |

| Item                                                                | Status | PR  |
| ------------------------------------------------------------------- | ------ | --- |
| **P1.** Separate durable workspace history from the live daemon set | open   |     |
| **P2.** Make operational-status delivery active-only or incremental | open   |     |
| **P3.** Slim the web-app sidebar subscriptions                      | open   |     |
| **P4.** Suppress no-op projection writes                            | open   |     |
| **P5.** Measure observer count and serialized result size           | open   |     |

## Scenario under review

Assume one machine has many projects, but only one or two projects currently have agents working. The desired behavior is that idle bandwidth is approximately proportional to the active projects, with a small fixed machine/daemon baseline.

Phase 2 removes the always-on workspace-list subscription. Daemons now receive a `daemon.workspaceListChanged` inbox nudge on watch-start/refresh or workspace membership changes and imperatively reconcile. Each accepted observation heartbeat schedules a one-shot expiry nudge at the fixed 60-second TTL, so expiry reconciliation does not require daemon polling. The query remains for imperative reconcile only and returns only working-directory strings.

The current behavior is instead a mixture of:

- current activity;
- projects observed recently by the web app;
- all persisted status rows associated with the machine; and
- all projects owned by the user in the web-app sidebar.

Consequently, a machine with 100 projects can still carry the state of dozens or hundreds of projects while only one or two agents are active.

## Findings

### 1. Recently observed workspace list is the highest-priority risk

`workspaces.listRecentlyObservedWorkspacesForMachine` is subscribed by the daemon through `packages/cli/src/daemon/infrastructure/convex/subscribers/workspace-list.ts`.

The backend query reads the machine's observed-workspace projections and includes every workspace whose chatroom was observed within `OBSERVATION_TTL_MS` (60 seconds). It returns working-directory strings, but the set can contain entries from many projects. See `services/backend/src/domain/usecase/workspace/list-recently-observed-workspaces-for-machine.ts`.

This directly matches the largest screenshot entries:

| Environment | Function                                              | Bandwidth |
| ----------- | ----------------------------------------------------- | --------: |
| Prod        | `workspaces.listRecentlyObservedWorkspacesForMachine` | 203.36 MB |
| Dev         | `workspaces.listRecentlyObservedWorkspacesForMachine` | 190.92 MB |

The web app records an observation for a visible chatroom approximately every 45 seconds. The daemon subscriber deduplicates the returned directory array before triggering downstream Git work, so an unchanged directory set does not necessarily cause a Git resynchronization. That optimization does not make the live query active-project-only: the query still depends on a potentially large machine-wide projection and can re-evaluate when observation/projection rows change.

Phase 1 and Phase 2 landed in PRs #1544 and #1545, replacing the live subscription with watch-gated inbox delivery. PR #1561 replaces safety polling with one-shot observation-expiry nudges.

### 2. Machine operational status is returned for all projects and roles

`machines.subscribeMachineAgentOperationalStatus` queries all `chatroom_agentRoleOperationalStatus` rows indexed by machine and maps every row into the subscription result. There is no filter for currently active projects or currently working roles. See `services/backend/convex/machines.ts` around the `subscribeMachineAgentOperationalStatus` query.

This is the likely explanation for the next significant screenshot entries:

| Environment | Function                                          | Bandwidth |
| ----------- | ------------------------------------------------- | --------: |
| Dev         | `machines.subscribeMachineAgentOperationalStatus` |  35.81 MB |
| Prod        | `machines.subscribeMachineAgentOperationalStatus` |  10.20 MB |

Each row is compact, but the result size grows with machine × project × role. Any operational-status change also invalidates a machine-wide result, so one active project can cause an update to a subscription whose result includes inactive projects.

### 3. The web app has an all-project baseline

Every authenticated `/app` session mounts five subscriptions in `apps/webapp/src/modules/chatroom/context/ChatroomListingContext.tsx`:

- all base chatroom rows;
- favorite IDs;
- unread status;
- one agent overview per chatroom; and
- all per-role status rows across all chatrooms.

The global `listAgentRoleStatusReadModel` query first loads every chatroom owned by the user and then collects every role-status row for every chatroom. This is a project-count-dependent reactive result even when no project is active.

The global `listByUser` query also returns complete chatroom documents rather than a narrow sidebar projection. Optional fields such as `standingInstructions` can make the baseline larger than the number of chatrooms alone suggests.

The compact `listAgentOverview` query is a better shape for a sidebar: it returns one summary per chatroom. The global per-role subscription appears unnecessary for a project list and should be scoped to the currently open chatroom or replaced with a compact per-chatroom summary.

### 4. Current-chatroom subscriptions are mostly appropriately scoped

When a chatroom is open, the dashboard subscribes to current-room data such as tasks, queued messages, agent status, daemon status, workspaces, and file-tree state. These paths generally scale with the active chatroom rather than with every project on the machine.

There are several `useAgentPanelData` call sites in dashboard children. Identical Convex queries may be client-deduplicated, so this is not proven to be duplicate network traffic, but centralizing the data at the dashboard/context boundary would make observer count and invalidation behavior easier to verify.

One definite duplicate observer exists in `apps/webapp/src/modules/chatroom/components/AgentSettingsModal.tsx`: a machine row calls `useDaemonConnected(machine.machineId)` and separately calls `getDaemonStatus` for the same machine. The settings UI is conditional, so this is a secondary issue rather than the primary idle source.

### 5. Task and command subscriptions are comparatively idle-friendly

`messageList.subscribeTaskStatusSignalsSince` is cursor-pinned and returns no result when there are no new signals. The daemon hydrates task snapshots imperatively after receiving a signal rather than polling the full task set continuously.

`daemon/machineCommandInbox.watchNext` returns only a pending command identifier and is empty when there is no command. These are good patterns for idle operation.

The screenshot's `messageList.subscribeTaskStatusSignalsSince` and `daemon/machineCommandInbox.watchNext` totals are therefore more likely to represent active task transitions, reconnect/catch-up traffic, or aggregate traffic over time than a large steady-state payload.

### 6. Heartbeats are a fixed machine/activity cost, not a project-count multiplier

Daemon heartbeats are throttled and separated from the larger machine/list queries. `daemonHeartbeat` should scale mainly with the number of machines and reconnects, not with the number of projects on a machine.

Frontend chatroom observations are also throttled, but each observation can update the projection that feeds the workspace-list subscription. This makes observation frequency relevant to workspace-list invalidation even when the returned directory set is unchanged.

### 7. Role-status projection writes may amplify global invalidations

`projectAgentRoleStatusReadModel` patches an existing role-status row on projection, including `projectedAt`, without an equality check. An active status transition can therefore invalidate the global all-project role-status subscription, whose result is sized by every project and role.

The operational-status projection has stronger no-op suppression. The role-status read model should receive equivalent equality suppression for fields that are not meaningfully changed.

## Screenshot interpretation

The screenshot is consistent with the following priority order:

1. `listRecentlyObservedWorkspacesForMachine`: large project/workspace set retained by the seven-day window.
2. `subscribeMachineAgentOperationalStatus`: all machine projects and roles in one reactive result.
3. `getAgentOverviewForChatroom`: current-chatroom data; large totals may indicate repeated observers, reconnects, or a busy chatroom rather than all-machine scaling.
4. `getDaemonStatus` and `getDaemonStatusesBatch`: compact payloads; high totals likely indicate observer/invocation frequency rather than payload size.
5. `daemonHeartbeat`: periodic machine cost, largely independent of project count.
6. `subscribeTaskStatusSignalsSince` and `machineCommandInbox.watchNext`: event-driven paths that should be quiet when idle.
7. Cleanup functions: backend maintenance traffic, not a primary client idle-bandwidth concern.

## Recommended remediation order

### Priority 1: separate durable workspace history from the live daemon set

Use a short-lived active/leased workspace set for the daemon, aligned with the observation/session TTL, while retaining longer-term workspace history separately if the product needs it.

Prefer a small machine-level membership revision or change signal over a subscription that returns the full workspace array. The daemon can fetch the full list imperatively only when membership changes.

### Priority 2: make operational-status delivery active-only or incremental

Add a machine-level revision/cursor and deliver status deltas, or limit the live subscription to roles with a current active lease. If restart recovery requires historical rows, fetch those imperatively during startup rather than keeping every historical role in the live result.

### Priority 3: slim the web-app sidebar subscriptions

Use one compact per-chatroom summary for the sidebar. Keep per-role status data scoped to the currently open chatroom. This removes the global `listAgentRoleStatusReadModel` result from the user's all-project baseline.

### Priority 4: suppress no-op projection writes

Compare visible role-status fields before patching the read-model row. Avoid using a timestamp-only change to invalidate a broad reactive result.

### Priority 5: measure observer count and serialized result size

For representative machines, record the following separately for each query:

- number of rows/workspaces returned;
- serialized result size;
- update frequency while idle;
- update frequency with one active agent; and
- number of browser and daemon observers.

The screenshot alone cannot determine how much of each total is steady-state idle traffic. A controlled test with many inactive projects and one active project will confirm whether the dominant cost is result size, invalidation frequency, or repeated invocation.

## Source references

- `packages/cli/src/daemon/infrastructure/convex/subscribers/workspace-list.ts`
- `services/backend/src/domain/usecase/workspace/list-recently-observed-workspaces-for-machine.ts`
- `services/backend/convex/machines.ts` — machine status queries
- `apps/webapp/src/modules/chatroom/context/ChatroomListingContext.tsx`
- `services/backend/convex/chatrooms.ts` — global chatroom listing
- `services/backend/src/domain/usecase/agent/project-agent-role-status-read-model.ts`
- `apps/webapp/src/modules/chatroom/components/AgentSettingsModal.tsx`
- `services/backend/config/reliability.ts` — observation and recency windows
