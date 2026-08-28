---
type: decision-log
title: Participant decoupling stack
description: Five-PR series removing participant presence from snapshots and daemon delivery, routing activity through lifecycle outbox, and projecting UI status from role-status read model.
tags: [participants, projection, daemon, migration, agents]
status: active
---

# Participant decoupling stack

## Context

Task snapshots and daemon delivery previously denormalized participant presence (`lastSeenAt`, `lastStatus`). Agent sidebar status labels now read `chatroom_agentRoleStatusReadModel`, but projection still queried `chatroom_participants` for `machineId`, `lastSeenAt`, and `lastInFlightTaskId`. Chat list activity already uses `listAgentRoleStatusReadModel`; AgentPanel `lastSeen` still flows through `getAgentViewStatus` participant fields.

## Stack (merge bottom-up)

| PR      | Branch                                                   | Status               | Scope                                                                                                                   |
| ------- | -------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 #1524 | `feat/snapshot-remove-participant-presence`              | Open                 | Remove participant fields from task snapshot projection                                                                 |
| 2 #1525 | `feat/daemon-local-stale-turn`                           | Open                 | Stale-turn from local slot + pending task only                                                                          |
| 3 #1526 | `feat/heartbeat-lifecycle-outbox`                        | Open                 | Native activity via lifecycle outbox + backend heartbeat                                                                |
| —       | `fix/enhancer-job-complete-on-handoff` → #1529           | Open                 | Enhancer stack (see enhancer-handoff-only-stack.md)                                                                     |
| 4       | `feat/role-status-without-participant`                   | **Complete (#1530)** | Decouple `projectAgentRoleStatusReadModel` from participant reads                                                       |
| 5       | `feat/presence-from-role-status`                         | **Complete (#1531)** | AgentPanel lastSeen from read model; drop participant lifecycle reads for UI                                            |
| 6       | `feat/operational-status-without-participant-laststatus` | Open                 | Remove participant `lastStatus` reads from operational projection rebuild/connectivity + `getAgentViewStatus` inference |

PR4 stacks on `feat/enhancer-task-delivery` (current tip). PR5 stacks on PR4.

## PR4 scope

`projectAgentRoleStatusReadModel` must not query `chatroom_participants`:

- `machineId` from `chatroom_teamAgentConfigs` only
- `activeWork` from `findActiveAssignedTaskForRole` when status is `working`
- `lastSeenAt` updated on activity/heartbeat paths directly on the read model row (preserve existing value when not supplied)

## PR5 scope

- `useAgentPanelData` / AgentPanel: `lastSeenAt` from `statusReadModel.lastSeenAt` (not `getAgentViewStatus` participant map)
- Remove or narrow `getTeamLifecycle` participant presence for UI consumers that now use read model
- Chat list already uses `listAgentRoleStatusReadModel` — verify no remaining participant presence joins for activity dots

## Related

- `/migrations/agent-operational-status-projection.md`
- `/development/agent-operational-status-tech-debt.md`
- `/migrations/enhancer-handoff-only-stack.md`
