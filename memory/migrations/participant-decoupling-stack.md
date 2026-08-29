---
type: decision-log
title: Participant decoupling stack
description: Multi-PR series removing participant presence from snapshots, daemon delivery, UI read models, and operational projection; remaining readers tracked PR7+.
tags: [participants, projection, daemon, migration, agents]
status: active
---

# Participant decoupling stack

## Context

Task snapshots and daemon delivery previously denormalized participant presence (`lastSeenAt`, `lastStatus`). PR4–PR6 removed participant reads from role-status projection, UI `lastSeenAt`, and operational `viewState` inference. **`chatroom_participants` remains the write path** and is still read for orchestration, handoff routing, connection supersession, and session lifecycle. See **Remaining readers** below for the decoupling backlog ordered simplest-first.

## Stack (merge bottom-up)

| PR      | Branch                                                   | Status                     | Scope                                                                                                                   |
| ------- | -------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 #1523 | `fix/handoff-sender-waiting-status`                      | **Complete (#1523)**       | Sender `agent.waiting` after handoff; queue promotion ordering                                                          |
| 2 #1524 | `feat/snapshot-remove-participant-presence`              | **Complete (#1524)**       | Remove participant fields from task snapshot projection                                                                 |
| 3 #1525 | `feat/daemon-local-stale-turn`                           | **Complete (#1525)**       | Stale-turn from local slot + pending task only                                                                          |
| 4 #1526 | `feat/heartbeat-lifecycle-outbox`                        | **Complete (#1526)**       | Native activity via lifecycle outbox + backend heartbeat                                                                |
| —       | `fix/enhancer-job-complete-on-handoff` → #1529           | **Complete (#1527–#1529)** | Enhancer stack (see enhancer-handoff-only-stack.md)                                                                     |
| 5       | `feat/role-status-without-participant`                   | **Complete (#1530)**       | Decouple `projectAgentRoleStatusReadModel` from participant reads                                                       |
| 6       | `feat/presence-from-role-status`                         | **Complete (#1531)**       | AgentPanel lastSeen from read model; drop participant lifecycle reads for UI                                            |
| 7       | `feat/operational-status-without-participant-laststatus` | **Complete (#1532)**       | Remove participant `lastStatus` reads from operational projection rebuild/connectivity + `getAgentViewStatus` inference |
| —       | `feat/unified-native-delivery-reconcile`                 | **Complete (#1533)**       | Native delivery on inbox reconcile path                                                                                 |
| —       | `feat/promotion-wake-offline-agents`                     | **Complete (#1534)**       | Wake offline agents on queue promotion                                                                                  |
| —       | `fix/agent-stop-startup-convergence`                     | **Complete (#1535)**       | Orphaned stop commands converge on daemon restart                                                                       |
| —       | `fix/agent-stop-10s-ttl`                                 | **Complete (#1536)**       | 10s scoped stop TTL; eager expiry; `user.start` supersedes                                                              |
| —       | `refactor/agent-reason-*`                                | **Complete (#1537–#1538)** | Reason predicates and SSOT enums on hot paths                                                                           |
| —       | `fix/codex-enhancer-graceful-teardown`                   | **Complete (#1539)**       | Codex `agent_end` before spawn stop                                                                                     |

PR4 (#1526) stacks on PR3. PR5 (#1530) stacks on enhancer delivery. PR6 (#1531) stacks on PR5. PR7 (#1532) stacks on PR6. **Next slice: PR8** (`feat/remove-dead-to-participant-view`).

## PR4 scope (#1526)

Native activity via lifecycle outbox; backend `applyAgentActivityHeartbeat` projects role status `lastSeenAt`.

## PR5 scope (#1530)

`projectAgentRoleStatusReadModel` must not query `chatroom_participants`:

- `machineId` from `chatroom_teamAgentConfigs` only
- `activeWork` from `findActiveAssignedTaskForRole` when status is `working`
- `lastSeenAt` updated on activity/heartbeat paths directly on the read model row (preserve existing value when not supplied)

## PR6 scope (#1531)

- `useAgentPanelData` / AgentPanel: `lastSeenAt` from `statusReadModel.lastSeenAt` (not `getAgentViewStatus` participant map)
- Remove or narrow `getTeamLifecycle` participant presence for UI consumers that now use read model
- Chat list already uses `listAgentRoleStatusReadModel` — verify no remaining participant presence joins for activity dots

## PR7 scope (#1532)

`projectAgentOperationalStatus` rebuild/connectivity and `getAgentViewStatus` must not infer operational state from participant `lastStatus`:

- `project-agent-operational-status.ts`: remove participant queries from `projectAgentOperationalStatusForChatroom` rebuild and `projectAgentOperationalStatusOnDaemonConnectivity`; default `viewState` to config-derived `operationalState` (ephemeral idle override preserved)
- `get-agent-view-status.ts`: read `viewState` from `chatroom_agentRoleOperationalStatus` only; remove `IN_FLIGHT_START_STATUSES` participant fallback
- Participant reads in `getAgentViewStatus` remain for `agentType`, `lastSeenAt`, `lastSeenAction` (PR9)

## PR8 scope (next)

Remove dead `toParticipantView` export from `assigned-tasks-core.ts`:

- Delete `toParticipantView` function (lines ~63–80) and its `@deprecated` comment
- Grep confirms zero callers outside the definition
- No snapshot projection changes — PR1 already removed participant fields from snapshot contract
- Stacks on PR7 (`feat/operational-status-without-participant-laststatus`, merged #1532)

## Remaining readers (complexity order)

Ordered simplest → hardest. Each row is a proposed future slice (PR7+). Status `Pending` until a branch is opened.

| PR  | Branch                                 | Slice                                            | Status   | Complexity | Production readers removed                                                                                                                                                                                                                                                                |
| --- | -------------------------------------- | ------------------------------------------------ | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | `feat/remove-dead-to-participant-view` | Dead `toParticipantView` helper                  | **Next** | Trivial    | `assigned-tasks-core.ts` — deprecated helper unused after PR2                                                                                                                                                                                                                             |
| 9   | —                                      | Legacy presence API removal                      | Pending  | Low        | `chatrooms.ts` (`listByUserWithStatus`, `listParticipantPresence`, `getPresenceForChatroom`); `participants.ts` (`getTeamLifecycle`) — no current webapp/CLI consumers                                                                                                                    |
| 10  | —                                      | `getAgentViewStatus` presence narrowing          | Pending  | Low–Med    | `get-agent-view-status.ts` — stop reading `agentType`, `lastSeenAt`, `lastSeenAction`; source from team config + `chatroom_agentRoleStatusReadModel`                                                                                                                                      |
| 11  | —                                      | Restart-offline from operational projection      | Pending  | Medium     | `restart-offline-agents-on-user-message.ts` — replace `lastStatus`/`lastSeenAction` reads with operational projection + read model                                                                                                                                                        |
| 12  | —                                      | Queue promotion gate without `lastSeenAction`    | Pending  | Medium     | `convex/lib/chatroomUtils.ts` (`areAllAgentsWaiting`); `convex/tasks.ts` caller — needs alternate "all agents waiting" signal                                                                                                                                                             |
| 13  | —                                      | Handoff routing decoupling                       | Pending  | High       | `convex/messages.ts` (5 participant query sites for `availableRoles`/delivery prompts + post-handoff cleanup); `convex/daemon/enhancer/taskDeliveryForJob.ts`; `participants.ts` (`getHighestPriorityWaitingRole`)                                                                        |
| 14  | —                                      | Task/native orchestration via participant lookup | Pending  | High       | `getParticipantForChatroomRole` in `assigned-tasks-core.ts` and callers: `transition-agent-status.ts`, `release-tasks-on-agent-exit.ts`, `find-native-harness-in-progress-work.ts`, `handle-native-agent-end.ts`, `project-agent-lifecycle-fact.ts` / `apply-agent-activity-heartbeat.ts` |
| 15  | —                                      | Agent lifecycle + ephemeral cleanup              | Pending  | High       | `agent-exited.ts`, `release-ephemeral-agent-role.ts`, `register-ephemeral-participant.ts`                                                                                                                                                                                                 |
| 16  | —                                      | Core session / connection supersession           | Pending  | Highest    | `convex/participants.ts` (join, getByRole, updateTokenActivity, connectionId); `convex/tasks.ts` (`connectionId` supersession in `getPendingTasksForRole`)                                                                                                                                |

### Infrastructure (retain until table retirement)

| File                        | Purpose                          |
| --------------------------- | -------------------------------- |
| `convex/migrations.ts`      | One-off migration reads          |
| `convex/chatroomCleanup.ts` | Orphan participant batch cleanup |

### Already migrated (PR1–PR6)

| Concern                                | Was                      | Now                                                             |
| -------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| Task snapshot participant fields       | Read participants        | PR1 — removed from snapshot projection                          |
| Daemon stale-turn participant presence | Read participants        | PR2 — local slot + pending task                                 |
| Native activity heartbeat              | Direct participant patch | PR3 — lifecycle outbox                                          |
| Role status projection                 | Read participants        | PR4 — team config + tasks only                                  |
| AgentPanel / setup `lastSeenAt`        | `getAgentViewStatus`     | PR5 — `chatroom_agentRoleStatusReadModel`                       |
| Operational `viewState` inference      | Read `lastStatus`        | PR6 — projected `viewState` / config-derived `operationalState` |
| Chat list activity dots                | `listByUserWithStatus`   | PR5 — `listAgentRoleStatusReadModel`                            |

## Related

- `/migrations/agent-operational-status-projection.md`
- `/development/agent-operational-status-tech-debt.md`
- `/migrations/enhancer-handoff-only-stack.md`
