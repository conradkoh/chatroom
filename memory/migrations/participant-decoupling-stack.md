---
type: decision-log
title: Participant decoupling stack
description: Five-PR series removing participant presence from snapshots and daemon delivery, routing activity through lifecycle outbox, and projecting UI status from role-status read model.
tags: [participants, projection, daemon, migration, agents]
status: active
---

# Participant decoupling stack

## Context

Task snapshots and daemon delivery previously denormalized participant presence (`lastSeenAt`, `lastStatus`). PR4–PR6 removed participant reads from role-status projection, UI `lastSeenAt`, and operational `viewState` inference. **`chatroom_participants` remains the write path** and is still read for orchestration, handoff routing, connection supersession, and session lifecycle. See **Remaining readers** below for the decoupling backlog ordered simplest-first.

## Stack (merge bottom-up)

| PR      | Branch                                                   | Status               | Scope                                                                                                                   |
| ------- | -------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 #1524 | `feat/snapshot-remove-participant-presence`              | Open                 | Remove participant fields from task snapshot projection                                                                 |
| 2 #1525 | `feat/daemon-local-stale-turn`                           | Open                 | Stale-turn from local slot + pending task only                                                                          |
| 3 #1526 | `feat/heartbeat-lifecycle-outbox`                        | Open                 | Native activity via lifecycle outbox + backend heartbeat                                                                |
| —       | `fix/enhancer-job-complete-on-handoff` → #1529           | Open                 | Enhancer stack (see enhancer-handoff-only-stack.md)                                                                     |
| 4       | `feat/role-status-without-participant`                   | **Complete (#1530)** | Decouple `projectAgentRoleStatusReadModel` from participant reads                                                       |
| 5       | `feat/presence-from-role-status`                         | **Complete (#1531)** | AgentPanel lastSeen from read model; drop participant lifecycle reads for UI                                            |
| 6       | `feat/operational-status-without-participant-laststatus` | **Complete (#1532)** | Remove participant `lastStatus` reads from operational projection rebuild/connectivity + `getAgentViewStatus` inference |

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

## Remaining readers (complexity order)

Ordered simplest → hardest. Each row is a proposed future slice (PR7+). Status `Pending` until a branch is opened.

| PR  | Slice                                              | Status    | Complexity | Production readers removed                                                                 |
| --- | -------------------------------------------------- | --------- | ---------- | ------------------------------------------------------------------------------------------ |
| 7   | Dead `toParticipantView` helper                    | Pending   | Trivial    | `assigned-tasks-core.ts` — deprecated helper unused after PR1                              |
| 8   | Legacy presence API removal                        | Pending   | Low        | `chatrooms.ts` (`listByUserWithStatus`, `listParticipantPresence`, `getPresenceForChatroom`); `participants.ts` (`getTeamLifecycle`) — no current webapp/CLI consumers |
| 9   | `getAgentViewStatus` presence narrowing            | Pending   | Low–Med    | `get-agent-view-status.ts` — stop reading `agentType`, `lastSeenAt`, `lastSeenAction`; source from team config + `chatroom_agentRoleStatusReadModel` |
| 10  | Restart-offline from operational projection        | Pending   | Medium     | `restart-offline-agents-on-user-message.ts` — replace `lastStatus`/`lastSeenAction` reads with operational projection + read model |
| 11  | Queue promotion gate without `lastSeenAction`      | Pending   | Medium     | `convex/lib/chatroomUtils.ts` (`areAllAgentsWaiting`); `convex/tasks.ts` caller — needs alternate "all agents waiting" signal |
| 12  | Handoff routing decoupling                         | Pending   | High       | `convex/messages.ts` (5 participant query sites for `availableRoles`/delivery prompts + post-handoff cleanup); `convex/daemon/enhancer/taskDeliveryForJob.ts`; `participants.ts` (`getHighestPriorityWaitingRole`) |
| 13  | Task/native orchestration via participant lookup   | Pending   | High       | `getParticipantForChatroomRole` in `assigned-tasks-core.ts` and callers: `transition-agent-status.ts`, `release-tasks-on-agent-exit.ts`, `find-native-harness-in-progress-work.ts`, `handle-native-agent-end.ts`, `project-agent-lifecycle-fact.ts` / `apply-agent-activity-heartbeat.ts` |
| 14  | Agent lifecycle + ephemeral cleanup                | Pending   | High       | `agent-exited.ts`, `release-ephemeral-agent-role.ts`, `register-ephemeral-participant.ts` |
| 15  | Core session / connection supersession             | Pending   | Highest    | `convex/participants.ts` (join, getByRole, updateTokenActivity, connectionId); `convex/tasks.ts` (`connectionId` supersession in `getPendingTasksForRole`) |

### Infrastructure (retain until table retirement)
| File | Purpose |
| --- | --- |
| `convex/migrations.ts` | One-off migration reads |
| `convex/chatroomCleanup.ts` | Orphan participant batch cleanup |

### Already migrated (PR1–PR6)
| Concern | Was | Now |
| --- | --- | --- |
| Task snapshot participant fields | Read participants | PR1 — removed from snapshot projection |
| Daemon stale-turn participant presence | Read participants | PR2 — local slot + pending task |
| Native activity heartbeat | Direct participant patch | PR3 — lifecycle outbox |
| Role status projection | Read participants | PR4 — team config + tasks only |
| AgentPanel / setup `lastSeenAt` | `getAgentViewStatus` | PR5 — `chatroom_agentRoleStatusReadModel` |
| Operational `viewState` inference | Read `lastStatus` | PR6 — projected `viewState` / config-derived `operationalState` |
| Chat list activity dots | `listByUserWithStatus` | PR5 — `listAgentRoleStatusReadModel` |

## Related

- `/migrations/agent-operational-status-projection.md`
- `/development/agent-operational-status-tech-debt.md`
- `/migrations/enhancer-handoff-only-stack.md`
